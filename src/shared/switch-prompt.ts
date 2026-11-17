/** Asks before a #better-gmail=on|off link changes anything: any page can open one. Built like the return button: a closed shadow root on <html>, node by node for Gmail's Trusted Types. */
export interface SwitchPromptOptions {
  /** What the link asks for: true turns Expressive on. */
  on: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SWITCH_PROMPT_ID = 'better-gmail-switch';

const COPY = {
  on: { question: 'Switch to Expressive Gmail?', confirm: 'Switch to Expressive', cancel: 'Keep classic' },
  off: { question: 'Switch to classic Gmail?', confirm: 'Switch to classic', cancel: 'Keep Expressive' },
};

// Gmail's own dialog colors, light and dark. Above the app's frame (z-index 2147483646).
const STYLE = `
:host { all: initial; }
.card {
  position: fixed;
  top: 16px;
  left: 50%;
  z-index: 2147483647;
  box-sizing: border-box;
  width: max-content;
  max-width: calc(100vw - 32px);
  translate: -50% 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 12px 12px 12px 24px;
  border-radius: 28px;
  background: #f0f4f9;
  color: #1f1f1f;
  box-shadow: 0 1px 3px rgb(0 0 0 / .3), 0 4px 8px 3px rgb(0 0 0 / .15);
  font: 400 14px/20px "Google Sans", "Google Sans Text", Roboto, Arial, sans-serif;
  letter-spacing: .25px;
  transition: opacity 200ms cubic-bezier(.23, 1, .32, 1), transform 200ms cubic-bezier(.23, 1, .32, 1);
  @starting-style { opacity: 0; transform: translateY(-8px); }
}
.question { margin: 0; font-size: 16px; line-height: 24px; letter-spacing: 0; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-inline-start: auto; }
button {
  all: unset;
  position: relative;
  box-sizing: border-box;
  height: 40px;
  padding: 0 16px;
  border-radius: 20px;
  white-space: nowrap;
  font: 500 14px/20px "Google Sans", "Google Sans Text", Roboto, Arial, sans-serif;
  letter-spacing: .1px;
  cursor: pointer;
  color: #0b57d0;
  transition: border-radius 150ms cubic-bezier(.23, 1, .32, 1);
}
button::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: currentColor;
  opacity: 0;
  transition: opacity 150ms;
}
@media (hover: hover) and (pointer: fine) { button:hover::before { opacity: .08; } }
button:active { border-radius: 8px; }
button:active::before { opacity: .1; }
button:focus-visible { outline: 3px solid #0b57d0; outline-offset: 2px; }
.confirm { background: #0b57d0; color: #fff; }
@media (prefers-color-scheme: dark) {
  .card { background: #282a2c; color: #e3e3e3; }
  button { color: #a8c7fa; }
  button:focus-visible { outline-color: #a8c7fa; }
  .confirm { background: #a8c7fa; color: #062e6f; }
}
@media (prefers-reduced-motion: reduce) {
  .card { transition: opacity 200ms ease; @starting-style { transform: none; } }
  button { transition: none; }
}
@media print { .card { display: none; } }
`;

/** Returns a function that removes it. */
export function mountSwitchPrompt({ on, onConfirm, onCancel }: SwitchPromptOptions, doc: Document = document): () => void {
  doc.getElementById(SWITCH_PROMPT_ID)?.remove();
  const copy = on ? COPY.on : COPY.off;
  const host = doc.createElement('div');
  host.id = SWITCH_PROMPT_ID;
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const card = doc.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-labelledby', 'q');
  const question = doc.createElement('p');
  question.id = 'q';
  question.className = 'question';
  question.textContent = copy.question;
  const actions = doc.createElement('div');
  actions.className = 'actions';
  const button = (text: string, className: string, act: () => void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.addEventListener('click', () => {
      stop();
      act();
    });
    return b;
  };
  const cancel = button(copy.cancel, 'cancel', onCancel);
  actions.append(cancel, button(copy.confirm, 'confirm', onConfirm));
  card.append(question, actions);
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    stop();
    onCancel();
  });
  root.append(style, card);

  let removed = false;
  // Gmail rebuilds its page as it loads; the question stays until it's answered.
  const keep = new MutationObserver(() => {
    if (!removed && !host.isConnected) doc.documentElement.append(host);
  });
  function stop() {
    removed = true;
    keep.disconnect();
    host.remove();
  }
  doc.documentElement.append(host);
  keep.observe(doc.documentElement, { childList: true });
  // Keyboard users land on the answer that changes nothing.
  cancel.focus({ preventScroll: true });
  return stop;
}
