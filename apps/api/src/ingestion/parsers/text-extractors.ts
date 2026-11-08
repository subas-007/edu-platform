import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { fetchPublicWebPage } from './safe-url-fetcher';

const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARS = 2_000_000;

/**
 * pdf-parse v2 (current pdfjs-dist). v1 bundled pdf.js 1.10, which failed
 * intermittently on valid PDFs ("bad XRef entry", "Illegal character").
 */
export async function extractTextFromPdf(file: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(file) });
  try {
    const { text } = await parser.getText({ first: MAX_PDF_PAGES });
    return text;
  } finally {
    await parser.destroy();
  }
}

export async function extractTextFromDocx(file: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: file });
  return value;
}

export async function extractTextFromImage(file: Buffer): Promise<string> {
  // In production set langPath/cachePath to self-hosted traineddata (no runtime CDN fetch).
  const worker = await createWorker('eng');
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
