import { getDiagnostics } from '../../src/app/lib/host';
import { HOST } from '../../src/app/lib/appHost';

const diag = (origin: string, lines: string[]) =>
  window.dispatchEvent(new MessageEvent('message', { data: { source: 'better-gmail/content', type: 'diag', lines }, origin, source: window.parent }));

describe('messages from the page hosting the frame', () => {
  it('are read only from that page\'s origin', () => {
    diag('https://evil.example.com', ['forged']);
    expect(getDiagnostics()).toEqual([]);
    diag(HOST, ['session ready']);
    expect(getDiagnostics()).toEqual(['session ready']);
  });
});
