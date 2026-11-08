import { analyze, type Analysis, type Pixels } from './analyze';

/** Quantizing and scanning takes tens of ms, so a worker does it; where one can't start, it runs here after the current frame. */
export function analyzeOffThread(pixels: Pixels): Promise<Analysis> {
  return new Promise((resolve) => {
    const inline = () => setTimeout(() => resolve(analyze(pixels)), 0);
    let worker: Worker;
    try {
      worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      inline();
      return;
    }
    const done = (fn: () => void) => {
      worker.terminate();
      fn();
    };
    worker.onmessage = (e: MessageEvent<Analysis>) => done(() => resolve(e.data));
    worker.onerror = (e) => {
      e.preventDefault();
      done(inline);
    };
    // The pixels are copied: callers keep their buffer.
    worker.postMessage(pixels);
  });
}
