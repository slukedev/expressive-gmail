/// <reference types="vite/client" />
// Loaded with import() only, so pdf.js stays in its own chunk until a PDF needs it.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
// Bundled with the extension: MV3's CSP only runs workers from its own origin.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export interface OpenPdf {
  doc: PDFDocumentProxy;
  close: () => void;
}

export async function openPdf(data: Uint8Array): Promise<OpenPdf> {
  // Errors only; a malformed PDF just keeps its icon.
  const task = getDocument({ data, verbosity: 0 });
  return { doc: await task.promise, close: () => void task.destroy() };
}

export async function drawPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number, scale = 1): Promise<void> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width / base.width) * scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
}

/** For attachment cards. */
export async function firstPageImage(data: Uint8Array, width: number): Promise<Blob | undefined> {
  const { doc, close } = await openPdf(data);
  try {
    const page = await doc.getPage(1);
    const canvas = document.createElement('canvas');
    await drawPage(page, canvas, width);
    return await new Promise<Blob | undefined>((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.85));
  } finally {
    close();
  }
}
