import { useEffect, useRef, useState } from 'react';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import type { PDFDocumentProxy } from './pdf';

/** Each page drawn when it comes near the viewport. */
export function PdfPages({ blob, title, onError }: { blob: Blob; title: string; onError: () => void }) {
  const [state, setState] = useState<{ doc: PDFDocumentProxy; aspect: number } | null>(null);
  const failed = useRef(onError);
  useEffect(() => {
    failed.current = onError;
  });
  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;
    (async () => {
      const { openPdf } = await import('./pdf');
      const opened = await openPdf(new Uint8Array(await blob.arrayBuffer()));
      close = opened.close;
      if (cancelled) return close();
      const doc = opened.doc;
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      if (!cancelled) setState({ doc, aspect: first.width / first.height });
    })().catch(() => !cancelled && failed.current());
    return () => {
      cancelled = true;
      setState(null);
      close?.();
    };
  }, [blob]);
  if (!state) return <LoadingIndicator contained label="Loading preview" />;
  return (
    <div className="viewer__pdf" role="document" aria-label={title} tabIndex={0}>
      {Array.from({ length: state.doc.numPages }, (_, i) => (
        <PdfPage key={i} doc={state.doc} n={i + 1} aspect={state.aspect} />
      ))}
    </div>
  );
}

function PdfPage({ doc, n, aspect }: { doc: PDFDocumentProxy; n: number; aspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(aspect);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        void (async () => {
          const { drawPage } = await import('./pdf');
          const page = await doc.getPage(n);
          if (cancelled) return;
          const v = page.getViewport({ scale: 1 });
          setRatio(v.width / v.height);
          await drawPage(page, canvas, canvas.clientWidth || 800, Math.min(window.devicePixelRatio || 1, 2));
          if (!cancelled) setDrawn(true);
        })().catch(() => undefined);
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(canvas);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [doc, n]);
  return <canvas ref={ref} className="viewer__page" data-drawn={drawn || undefined} style={{ aspectRatio: String(ratio) }} aria-label={`Page ${n}`} />;
}
