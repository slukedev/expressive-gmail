import { afterEach, describe, expect, it, vi } from 'vitest';
import { gmailLooksDark, mountReturnButton, RETURN_HOST_ID } from '../../src/shared/return-button';

let stops: (() => void)[] = [];

// The button's root is closed on the page; open it here to press its buttons.
function mount() {
  let root: ShadowRoot | undefined;
  const attach = Element.prototype.attachShadow;
  const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element) {
    root = attach.call(this, { mode: 'open' });
    return root;
  });
  const onSwitch = vi.fn();
  const onDismiss = vi.fn();
  let stop: () => void;
  try {
    stop = mountReturnButton({ onSwitch, onDismiss });
  } finally {
    spy.mockRestore();
  }
  stops.push(stop!);
  const button = (name: string) => [...root!.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)!;
  return { onSwitch, onDismiss, stop, button };
}

const host = () => document.getElementById(RETURN_HOST_ID);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('classic Gmail return button', () => {
  afterEach(() => {
    stops.forEach((stop) => stop());
    stops = [];
    document.body.removeAttribute('style');
  });

  it('switches back when pressed', () => {
    const { onSwitch, button } = mount();
    expect(host()?.parentElement).toBe(document.documentElement);
    button('Switch to Expressive').click();
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it('comes back when the page throws it away, until it is hidden', async () => {
    const { onDismiss, button } = mount();
    host()!.remove();
    await settle();
    expect(host()).not.toBeNull();

    button('Hide this button').click();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(host()).toBeNull();
    document.documentElement.append(document.createElement('div'));
    await settle();
    expect(host()).toBeNull();
  });

  it('only ever shows one', () => {
    mount();
    mount();
    expect(document.querySelectorAll(`#${RETURN_HOST_ID}`)).toHaveLength(1);
  });

  it("matches Gmail's theme from its page", () => {
    document.body.style.backgroundColor = 'rgb(32, 33, 36)';
    expect(gmailLooksDark()).toBe(true);
    document.body.style.backgroundColor = 'rgb(246, 248, 252)';
    expect(gmailLooksDark()).toBe(false);
  });
});
