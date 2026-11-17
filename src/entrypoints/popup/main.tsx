import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../app/theme/tokens.css';
import '../../app/ui/ui.css';
import './popup.css';
import { Button } from '../../app/ui/Button';
import { Switch } from '../../app/ui/Switch';
import { BrandMark } from '../../app/features/shell/BrandMark';
import { GOOGLE_DARK, GOOGLE_LIGHT } from '../../app/theme/google-palette';
import { switchableTabs, type SwitchableTab } from '../../shared/gmail-tabs';

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyScheme() {
  const dark = darkQuery.matches;
  for (const [k, v] of Object.entries(dark ? GOOGLE_DARK : GOOGLE_LIGHT)) document.documentElement.style.setProperty(`--md-sys-color-${k}`, v);
  document.documentElement.dataset.themeMode = dark ? 'dark' : 'light';
}
applyScheme();
darkQuery.addEventListener('change', applyScheme);

const SOURCES: Record<string, string> = {
  session: 'Using your Gmail session',
  api: 'Using the Gmail API',
  // Release builds have no demo; a saved choice of it uses the session.
  demo: import.meta.env.DEV ? 'Showing the demo mailbox' : 'Using your Gmail session',
};

function Popup() {
  // Unknown until storage answers, so the switch never shows one state and then animates to the other.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [source, setSource] = useState('session');
  const [waiting, setWaiting] = useState<SwitchableTab[]>([]);
  useEffect(() => {
    void browser.storage.local.get(['bg.enabled', 'bg.settings.v1']).then((s) => {
      setEnabled(s['bg.enabled'] !== false);
      const saved = (s['bg.settings.v1'] as { backend?: string } | undefined)?.backend;
      setSource(saved && saved in SOURCES ? saved : 'session');
    });
  }, []);
  const reload = (tabs: SwitchableTab[]) => Promise.allSettled(tabs.map((t) => browser.tabs.reload(t.id)));
  const toggle = async (on: boolean) => {
    setEnabled(on);
    setWaiting([]);
    await browser.storage.local.set({ 'bg.enabled': on });
    const tabs = await switchableTabs();
    await reload(tabs.filter((t) => !t.unsent));
    setWaiting(tabs.filter((t) => t.unsent));
  };
  return (
    <main className="popup">
      <header className="popup__head">
        <BrandMark size={40} />
        <div>
          <h1 className="md-title-large">Expressive Gmail</h1>
          <p className="md-body-medium popup__sub" data-loading={enabled === null || undefined}>
            {enabled === false ? 'Classic Gmail is showing' : SOURCES[source]}
          </p>
        </div>
      </header>
      <label className="popup__row">
        <span className="md-body-large">Use the new Gmail</span>
        {enabled === null ? <span className="popup__switch-slot" /> : <Switch checked={enabled} onCheckedChange={(v) => void toggle(v)} label="Use the new Gmail" />}
      </label>
      {waiting.length > 0 && (
        <section className="popup__confirm" role="alertdialog" aria-labelledby="popup-confirm">
          <p id="popup-confirm" className="md-body-medium">
            {waiting.length === 1 ? 'Reload the Gmail tab with an unsent message?' : `Reload the ${waiting.length} Gmail tabs with unsent messages?`}
          </p>
          <div className="popup__confirm-actions">
            <Button variant="text" onClick={() => setWaiting([])}>
              Not now
            </Button>
            <Button
              variant="tonal"
              onClick={() => {
                void reload(waiting);
                setWaiting([]);
              }}
            >
              {waiting.length === 1 ? 'Reload tab' : 'Reload tabs'}
            </Button>
          </div>
        </section>
      )}
      <Button variant="filled" icon="open_in_new" onClick={() => void browser.tabs.create({ url: 'https://mail.google.com/mail/u/0/' })}>
        Open Gmail
      </Button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
