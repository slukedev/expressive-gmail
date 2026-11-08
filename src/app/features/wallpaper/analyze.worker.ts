import { analyze, type Pixels } from './analyze';

self.onmessage = (e: MessageEvent<Pixels>) => {
  const result = analyze(e.data);
  (self as unknown as Worker).postMessage(result, [result.saliency.data.buffer]);
};
