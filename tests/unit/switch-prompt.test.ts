import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSwitchPrompt, SWITCH_PROMPT_ID } from '../../src/shared/switch-prompt';

// The prompt's root is closed on the page; open it here to answer it.
function mount(on: boolean) {
  let root: ShadowRoot | undefined;
  const attach = Element.prototype.attachShadow;
  const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element) {
    root = attach.call(this, { mode: 'open' });
    return root;
  });
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  try {
    mountSwitchPrompt({ on, onConfirm, onCancel });
  } finally {
    spy.mockRestore();
  }
  const button = (name: string) => [...root!.querySelectorAll('button')].find((b) => b.textContent === name)!;
  return { root: root!, onConfirm, onCancel, button };
}

const host = () => document.getElementById(SWITCH_PROMPT_ID);

describe('switch link prompt', () => {
  afterEach(() => host()?.remove());

  it('changes nothing until the person agrees', () => {
    const { root, onConfirm, onCancel, button } = mount(false);
    expect(root.querySelector('[role="alertdialog"]')?.textContent).toContain('Switch to classic Gmail?');
    expect(onConfirm).not.toHaveBeenCalled();
    button('Switch to classic').click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(host()).toBeNull();
  });

  it('keeps things as they are on the other answer or Escape', () => {
    const first = mount(true);
    first.button('Keep classic').click();
    expect(first.onCancel).toHaveBeenCalledOnce();
    expect(first.onConfirm).not.toHaveBeenCalled();

    const second = mount(true);
    second.root.querySelector('.card')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(second.onCancel).toHaveBeenCalledOnce();
    expect(host()).toBeNull();
  });
});
