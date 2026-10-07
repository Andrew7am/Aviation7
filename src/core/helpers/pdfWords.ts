import type { PdfWord } from '../parsers/ibtekarInvoicePdf';
import { readPdf, type PdfContent } from './pdfRead';

/**
 * A PDF file, in the browser: its words, and the QR codes printed on it.
 *
 * The worker is pointed at the copy bundled with the app. Left to itself
 * pdf.js fetches one from a CDN at run time, which is a network call on a page
 * that is meant to work against a file the user already has.
 */
async function browserPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs;
}

export async function pdfContent(data: ArrayBuffer): Promise<PdfContent> {
  return readPdf(await browserPdfjs(), data);
}

export async function pdfToWords(data: ArrayBuffer): Promise<PdfWord[]> {
  return (await pdfContent(data)).words;
}
