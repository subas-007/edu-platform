import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import { fetchPublicWebPage } from './safe-url-fetcher';

// pdf-parse's index.js runs a debug harness when imported directly; use the lib entry.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (data: Buffer, options?: { max?: number }) => Promise<{ text: string }> =
  require('pdf-parse/lib/pdf-parse.js');

const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARS = 2_000_000;

export async function extractTextFromPdf(file: Buffer): Promise<string> {
  const { text } = await pdfParse(file, { max: MAX_PDF_PAGES });
  return text;
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
