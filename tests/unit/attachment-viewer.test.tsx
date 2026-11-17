import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { MailBackend } from '../../src/app/data/backend';

// jsdom has no matchMedia; the viewer reads the colour scheme and pointer type.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;

const { setBackend } = await import('../../src/app/data/client');
const { AttachmentViewer } = await import('../../src/app/features/attachments/AttachmentViewer');

describe('attachment preview', () => {
  it('keeps the loaded file when its parent re-renders with copies of the same list', async () => {
    const getAttachment = vi.fn(async () => ({ data: btoa('hello'), mimeType: 'text/plain' }));
    setBackend({ capabilities: {}, getAttachment } as unknown as MailBackend);
    const list = () => [{ id: 'a1', messageId: 'm1', filename: 'notes.txt', mimeType: 'text/plain', size: 5 }];
    const props = { index: 0, onIndex: () => {}, onClose: () => {} };
    const view = render(createElement(AttachmentViewer, { files: list(), ...props }));
    await waitFor(() => expect(document.body.textContent).toContain('hello'));
    view.rerender(createElement(AttachmentViewer, { files: list(), ...props }));
    view.rerender(createElement(AttachmentViewer, { files: list(), ...props }));
    await new Promise((r) => setTimeout(r, 0));
    expect(getAttachment).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('hello');
    view.unmount();
  });

  it('shows the file now selected when an earlier one finishes reading late', async () => {
    const getAttachment = vi.fn(async (_m: string, id: string) => ({ data: btoa(id === 'a1' ? 'first file' : 'second file'), mimeType: 'text/plain' }));
    setBackend({ capabilities: {}, getAttachment } as unknown as MailBackend);
    let finishFirst!: () => void;
    const text = Blob.prototype.text;
    const spy = vi.spyOn(Blob.prototype, 'text').mockImplementationOnce(function (this: Blob) {
      return new Promise<string>((resolve) => (finishFirst = () => void text.call(this).then(resolve)));
    });
    const files = [
      { id: 'a1', messageId: 'm1', filename: 'one.txt', mimeType: 'text/plain', size: 10 },
      { id: 'a2', messageId: 'm1', filename: 'two.txt', mimeType: 'text/plain', size: 11 },
    ];
    const props = { files, onIndex: () => {}, onClose: () => {} };
    const view = render(createElement(AttachmentViewer, { index: 0, ...props }));
    await waitFor(() => expect(finishFirst).toBeDefined());
    view.rerender(createElement(AttachmentViewer, { index: 1, ...props }));
    await waitFor(() => expect(document.body.textContent).toContain('second file'));
    finishFirst();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.body.textContent).toContain('second file');
    expect(document.body.textContent).not.toContain('first file');
    spy.mockRestore();
    view.unmount();
  });
});
