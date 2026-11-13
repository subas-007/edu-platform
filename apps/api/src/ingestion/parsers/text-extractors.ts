import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as mammoth from 'mammoth';
import { availableParallelism } from 'node:os';
import { PDFParse } from 'pdf-parse';
import { createWorker, type Worker as OcrWorker } from 'tesseract.js';
import { fetchPublicWebPage } from './safe-url-fetcher';

const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARS = 2_000_000;
/** A page whose text layer has fewer letters/digits than this is treated as scanned and OCR'd. */
const MIN_PAGE_TEXT_CHARS = 25;
/** Render width for OCR: about 240 dpi on A4/Letter, enough for body text at ~90% confidence. */
const OCR_RENDER_WIDTH = 2000;
/** Each OCR worker uses about one core; leave the rest for the API, the database and the local model. */
const OCR_WORKERS = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4)));

/** Called after each scanned page is read: pages done, pages to read. */
export type OcrProgress = (done: number, total: number) => Promise<void> | void;

/**
 * Text from each page's text layer. Pages without one (scanned or photographed books) are
 * rendered and read with OCR. pdf-parse's page markers ("-- 1 of 200 --") are left out:
 * they are not document text, and they made an image-only PDF look readable.
 *
 * pdf-parse v2 (current pdfjs-dist). v1 bundled pdf.js 1.10, which failed
 * intermittently on valid PDFs ("bad XRef entry", "Illegal character").
 */
export async function extractTextFromPdf(file: Buffer, onOcrProgress?: OcrProgress): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(file) });
  try {
    const { pages } = await parser.getText({ first: MAX_PDF_PAGES, pageJoiner: '' });
    const texts = new Map(pages.map((p) => [p.num, p.text]));
    const scanned = pages.filter((p) => readableChars(p.text) < MIN_PAGE_TEXT_CHARS).map((p) => p.num);
    if (scanned.length > 0) {
      for (const [num, text] of await ocrPdfPages(parser, scanned, onOcrProgress)) {
        if (readableChars(text) > readableChars(texts.get(num) ?? '')) texts.set(num, text);
      }
    }
    return pages.map((p) => texts.get(p.num) ?? '').join('\n\n');
  } finally {
    await parser.destroy();
  }
}

function readableChars(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

/**
 * Renders each page and reads it with a small pool of OCR workers. A page that cannot be
 * rendered or read is skipped (it adds no text) rather than failing the whole document.
 */
async function ocrPdfPages(parser: PDFParse, pageNums: number[], onProgress?: OcrProgress) {
  const results = new Map<number, string>();
  const workers: OcrWorker[] = [];
  let next = 0;
  let done = 0;
  try {
    for (let i = 0; i < Math.min(OCR_WORKERS, pageNums.length); i++) workers.push(await createOcrWorker());
    await Promise.all(
      workers.map(async (worker) => {
        while (next < pageNums.length) {
          const num = pageNums[next++];
          try {
            const shot = await parser.getScreenshot({
              partial: [num],
              desiredWidth: OCR_RENDER_WIDTH,
              imageBuffer: true,
              imageDataUrl: false,
            });
            const image = shot.pages[0]?.data;
            if (image) results.set(num, (await worker.recognize(Buffer.from(image))).data.text);
          } catch {
            // Unreadable page: leave it out.
          }
          done++;
          await onProgress?.(done, pageNums.length);
        }
      }),
    );
  } finally {
    await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
  }
  return results;
}

function createOcrWorker() {
  // In production set langPath/cachePath to self-hosted traineddata (no runtime CDN fetch).
  return createWorker('eng');
}

export async function extractTextFromDocx(file: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: file });
  return value;
}

export async function extractTextFromImage(file: Buffer): Promise<string> {
  const worker = await createOcrWorker();
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export async function extractTextFromUrl(rawUrl: string): Promise<string> {
  const { html, finalUrl } = await fetchPublicWebPage(rawUrl);
  // JSDOM defaults: scripts are NOT executed and sub-resources are NOT loaded.
  const dom = new JSDOM(html, { url: finalUrl, virtualConsole: new VirtualConsole() });
  try {
    const article = new Readability(dom.window.document).parse();
    return article?.textContent ?? dom.window.document.body?.textContent ?? '';
  } finally {
    dom.window.close();
  }
}

/** Removes control chars and excessive whitespace; caps length. */
export function normaliseExtractedText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}
