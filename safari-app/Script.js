// The Mac app's window. ViewController.swift calls render() with the installed
// browsers and the Safari extension's state; the page posts back what to do.
const post = (message) => webkit.messageHandlers.controller.postMessage(message);

let state = { browsers: [], selected: null, safari: null };

const browsersEl = document.querySelector('.browsers');
const switchEl = document.querySelector('.switch');
const subEl = document.getElementById('switch-sub');
const openEl = document.querySelector('.open');
const safariEl = document.querySelector('.safari');
const addEl = document.querySelector('.add');
const stepsEl = document.querySelector('.steps');

const current = () => state.browsers.find((b) => b.id === state.selected) ?? state.browsers[0];

function render(next) {
  if (next) state = { ...state, ...next };
  const browser = current();
  browsersEl.replaceChildren(
    ...state.browsers.map((b) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(b === browser));
      chip.tabIndex = b === browser ? 0 : -1;
      const icon = document.createElement('img');
      icon.src = b.icon;
      icon.alt = '';
      chip.append(icon, b.name);
      chip.addEventListener('click', () => select(b.id));
      return chip;
    }),
  );
  const on = browser?.on !== false;
  switchEl.setAttribute('aria-checked', String(on));
  switchEl.disabled = !browser;
  openEl.disabled = !browser;
  openEl.textContent = browser ? `Open Gmail in ${browser.name}` : 'Open Gmail';
  addEl.hidden = !browser?.addable;
  addEl.textContent = browser ? `Add to ${browser.name}` : 'Add to browser';
  if (!browser?.addable) stepsEl.hidden = true;
  requestAnimationFrame(fit);
  subEl.textContent = !browser ? 'No supported browser found.' : on ? 'Gmail opens with the new look.' : 'Gmail opens as classic Gmail.';

  safariEl.hidden = state.safari === null;
  if (state.safari !== null) {
    safariEl.querySelector('.safari__state').textContent = state.safari
      ? 'On in Safari.'
      : 'Off. Turn it on in Safari Settings.';
  }
}

// The window fits its content, growing when the add steps show.
let lastHeight = 0;
function fit() {
  const height = Math.ceil(document.body.getBoundingClientRect().height);
  if (height !== lastHeight) post({ action: 'height', value: (lastHeight = height) });
}

function select(id) {
  state.selected = id;
  post({ action: 'select', browser: id });
  render();
}

browsersEl.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step || !state.browsers.length) return;
  e.preventDefault();
  const i = state.browsers.indexOf(current());
  select(state.browsers[(i + step + state.browsers.length) % state.browsers.length].id);
  browsersEl.querySelector('[aria-checked="true"]')?.focus();
});

switchEl.addEventListener('click', () => {
  const browser = current();
  if (!browser) return;
  browser.on = browser.on === false;
  render();
  // The browser applies it: Gmail opens there with a link the extension reads.
  post({ action: 'switch', browser: browser.id, on: browser.on });
});

addEl.addEventListener('click', () => {
  stepsEl.hidden = false;
  fit();
  post({ action: 'add', browser: current().id });
});
openEl.addEventListener('click', () => current() && post({ action: 'open', browser: current().id }));
document.querySelector('.safari__settings').addEventListener('click', () => post({ action: 'safari-settings' }));

render();
