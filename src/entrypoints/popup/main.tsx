import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../app/theme/tokens.css';
import '../../app/ui/ui.css';
import './popup.css';
import { Button } from '../../app/ui/Button';
import { Switch } from '../../app/ui/Switch';
import { BrandMark } from '../../app/features/shell/BrandMark';
import { GOOGLE_DARK, GOOGLE_LIGHT } from '../../app/theme/google-palette';

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
  const [enabled, setEnabled] = useState(true);
  const [source, setSource] = useState('session');
  useEffect(() => {
    void browser.storage.local.get(['bg.enabled', 'bg.settings.v1']).then((s) => {
      setEnabled(s['bg.enabled'] !== false);
      setSource((s['bg.settings.v1'] as { backend?: string } | undefined)?.backend ?? 'session');
    });
  }, []);
  const toggle = async (on: boolean) => {
    setEnabled(on);
    await browser.storage.local.set({ 'bg.enabled': on });
    const tabs = await browser.tabs.query({ url: 'https://mail.google.com/*' });
    await Promise.all(tabs.map((t) => t.id !== undefined && browser.tabs.reload(t.id)));
  };
  return (
    <main className="popup">
      <header className="popup__head">
        <BrandMark size={40} />
        <div>
          <h1 className="md-title-large">Expressive Gmail</h1>
          <p className="md-body-medium popup__sub">{enabled ? SOURCES[source] : 'Classic Gmail is showing'}</p>
        </div>
      </header>
      <label className="popup__row">
        <span className="md-body-large">Use the new Gmail</span>
        <Switch checked={enabled} onCheckedChange={(v) => void toggle(v)} label="Use the new Gmail" />
      </label>
      <Button variant="filled" icon="open_in_new" onClick={() => void browser.tabs.create({ url: 'https://mail.google.com/mail/u/0/' })}>
        Open Gmail
      </Button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
