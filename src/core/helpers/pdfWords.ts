import type { PdfWord } from '../parsers/ibtekarInvoicePdf';

/**
 * A PDF file, as the words on its pages and where they were drawn.
 *
 * pdf.js hands back text items with a transform matrix in PDF user space,
 * whose origin is the bottom-left of the page. Everything that reads these
 * words thinks top-down, the way the page is read, so the y is flipped here
 * once rather than in every caller.
 *
 * The worker is pointed at the copy bundled with the app. Left to itself
 * pdf.js fetches one from a CDN at run time, which is a network call on a page
 * that is meant to work against a file the user already has.
 */
export async function pdfToWords(data: ArrayBuffer): Promise<PdfWord[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const doc = await pdfjs.getDocument({ data }).promise;
  const words: PdfWord[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      const text = (item.str ?? '').trim();
      if (!text) continue;
      const x = item.transform[4];
      const y = viewport.height - item.transform[5];
      // pdf.js emits a run of text, not a word. The parsers want words, and a
      // run's own width is all there is to place them by, so the run's width
      // is shared out across its characters.
      const parts = text.split(/\s+/).filter(Boolean);
      if (parts.length === 1) { words.push({ page: p - 1, x, y, text }); continue; }
      const per = (item.width ?? 0) / Math.max(text.length, 1);
      let at = 0;
      for (const part of parts) {
        const idx = text.indexOf(part, at);
        words.push({ page: p - 1, x: x + idx * per, y, text: part });
        at = idx + part.length;
      }
    }
  }
  return words;
}
