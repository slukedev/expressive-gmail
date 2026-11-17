import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';

const { Editor } = await import('../../src/app/features/compose/Editor');
const { flushEditors } = await import('../../src/app/features/compose/settle');

function type(onChange: (html: string) => void) {
  const view = render(createElement(Editor, { initialHtml: '', onChange, label: 'Message' }));
  const box = view.getByRole('textbox');
  box.innerHTML = '<div>Running late</div>';
  fireEvent.input(box);
  return view;
}

describe('typing in the editor', () => {
  it('reaches the draft before anything reads it', () => {
    const onChange = vi.fn();
    const view = type(onChange);
    flushEditors();
    expect(onChange).toHaveBeenLastCalledWith('<div>Running late</div>');
    view.unmount();
  });

  it('is kept when the editor closes right after a keystroke', () => {
    const onChange = vi.fn();
    type(onChange).unmount();
    expect(onChange).toHaveBeenLastCalledWith('<div>Running late</div>');
  });
});

describe('the template list', () => {
  it('closes when the editor loses focus, so it stops taking Enter and Tab from other fields', () => {
    const onSlash = vi.fn();
    const view = render(createElement(Editor, { initialHtml: '', onChange: () => {}, onSlash, label: 'Message' }));
    const box = view.getByRole('textbox');
    box.innerHTML = '<div>/</div>';
    fireEvent.input(box);
    const before = onSlash.mock.calls.length;
    fireEvent.blur(box);
    expect(onSlash.mock.calls.length).toBe(before + 1);
    expect(onSlash).toHaveBeenLastCalledWith(null);
    view.unmount();
  });
});
