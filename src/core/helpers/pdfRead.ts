import jsQR from 'jsqr';
import type { PdfWord } from '../parsers/ibtekarInvoicePdf';

/**
 * A PDF, as the words on its pages and the QR codes printed on them.
 *
 * Takes the pdf.js module rather than importing it, so the browser (with its
 * bundled worker) and a node script (with the legacy build) read a file the
 * same way, down to the word.
 *
 * pdf.js hands back text items with a transform matrix in PDF user space,
 * whose origin is the bottom-left of the page. Everything that reads these
 * words thinks top-down, the way the page is read, so the y is flipped here
 * once rather than in every caller.
 */

export interface PdfContent {
  words: PdfWord[];
  /** The text of every QR code found on an image in the file. */
  qrCodes: string[];
}

/* pdf.js image kinds. */
const GRAYSCALE_1BPP = 1, RGB_24BPP = 2, RGBA_32BPP = 3;

interface PdfImage {
  width: number; height: number; kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

function toRgba(img: PdfImage): Uint8ClampedArray | null {
  const { width: w, height: h } = img;
  if (img.data) {
    const src = img.data;
    const out = new Uint8ClampedArray(w * h * 4);
    if (img.kind === RGBA_32BPP) { out.set(src.subarray(0, out.length)); return out; }
    if (img.kind === RGB_24BPP) {
      for (let p = 0; p < w * h; p++) {
        out[p * 4] = src[p * 3]; out[p * 4 + 1] = src[p * 3 + 1];
        out[p * 4 + 2] = src[p * 3 + 2]; out[p * 4 + 3] = 255;
      }
      return out;
    }
    if (img.kind === GRAYSCALE_1BPP) {
      // Rows are padded to whole bytes.
      const stride = Math.ceil(w / 8);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = (src[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
          const p = (y * w + x) * 4;
          out[p] = out[p + 1] = out[p + 2] = v; out[p + 3] = 255;
        }
      return out;
    }
    return null;
  }
  // A browser build may hand back a decoded bitmap instead of the pixels.
  if (img.bitmap && typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img.bitmap, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  }
  return null;
}

/** QR codes are square. A banner or a logo is not worth decoding. */
const couldBeQr = (img: PdfImage) => {
  const r = img.width / Math.max(img.height, 1);
  return r > 0.8 && r < 1.25 && img.width >= 40 && img.width <= 2000;
};

export async function readPdf(pdfjs: any, data: ArrayBuffer | Uint8Array): Promise<PdfContent> {
  const doc = await pdfjs.getDocument({
    // A node Buffer is a Uint8Array that pdf.js refuses, so always a plain one.
    data: data instanceof Uint8Array
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() : new Uint8Array(data),
    // Pixels, not ImageBitmaps, so a QR code can be read in either runtime.
    isOffscreenCanvasSupported: false,
    isEvalSupported: false,
  }).promise;
  const words: PdfWord[] = [];
  const qrCodes: string[] = [];
  const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintImageXObjectRepeat]);

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

    // A QR code that cannot be read is reported by the caller as no QR code,
    // which is the safe direction: the document is then not taken as final.
    try {
      const ops = await page.getOperatorList();
      const names = new Set<string>();
      for (let i = 0; i < ops.fnArray.length; i++)
        if (imageOps.has(ops.fnArray[i])) names.add(ops.argsArray[i][0]);
      for (const name of names) {
        const store = name.startsWith('g_') ? page.commonObjs : page.objs;
        // An image can still be on its way from the worker when the operator
        // list arrives; the callback form waits for it, and a stuck one is let go.
        const img = await new Promise<PdfImage | null>(res => {
          const t = setTimeout(() => res(null), 5000);
          store.get(name, (o: PdfImage) => { clearTimeout(t); res(o ?? null); });
        });
        if (!img || !couldBeQr(img)) continue;
        const rgba = toRgba(img);
        if (!rgba) continue;
        const hit = jsQR(rgba, img.width, img.height);
        if (hit?.data) qrCodes.push(hit.data);
      }
    } catch { /* no images readable on this page */ }
  }
  return { words, qrCodes };
}
