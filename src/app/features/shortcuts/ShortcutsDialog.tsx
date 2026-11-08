import { useUi } from '../../state/ui';
import { updateSettings, useSettings } from '../../state/settings';
import { Dialog } from '../../ui/Dialog';
import { Switch } from '../../ui/Switch';
import { keyLabel } from '../../ui/keys';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Jump around',
    items: [
      ['Ctrl K', 'Command palette'],
      ['/', 'Search'],
      ['g then i', 'Go to Inbox'],
      ['g then s', 'Go to Starred'],
      ['g then b', 'Go to Snoozed'],
      ['g then t', 'Go to Sent'],
      ['g then d', 'Go to Drafts'],
      ['g then a', 'Go to All mail'],
      ['g then k', 'Go to Follow-ups'],
      ['g then r', 'Work through Reply later'],
      ['g then 0', 'Open All inboxes'],
      ['g then 1 to 9', 'Switch to your first to ninth account'],
    ],
  },
  {
    title: 'In the list',
    items: [
      ['j / k', 'Older / newer conversation'],
      ['Shift J / Shift K', 'Next / previous unread conversation'],
      ['o or Enter', 'Open conversation'],
      ['u', 'Back to the list'],
      ['x', 'Select conversation'],
      ['Shift X', 'Select from the last selected conversation to this one'],
      ['* then a', 'Select all'],
      ['* then n', 'Select none'],
      ['* then u', 'Select unread'],
      ['Shift N', 'Refresh'],
    ],
  },
  {
    title: 'Act on conversations',
    items: [
      ['e', 'Archive'],
      ['#', 'Delete'],
      ['!', 'Report spam'],
      ['s', 'Star or unstar'],
      ['Shift I / Shift U', 'Mark as read / unread'],
      ['b', 'Snooze'],
      ['l', 'Label as'],
      ['v', 'Move to'],
      ['m', 'Mute'],
      ['p', 'Pin to top of inbox'],
      ['Shift L', 'Reply later'],
      ['+ / -', 'Mark important / not important'],
      ['[ / ]', 'Archive and go newer / older'],
      ['z', 'Undo last action'],
    ],
  },
  {
    title: 'Write',
    items: [
      ['c', 'Compose'],
      ['r', 'Reply'],
      ['a', 'Reply all'],
      ['f', 'Forward'],
      ['Ctrl Enter', 'Send'],
      ['Ctrl Shift Enter', 'Schedule send'],
      ['Ctrl K', 'Insert link (in a message)'],
      ['Ctrl Shift C / Ctrl Shift B', 'Add Cc / Bcc (in a message)'],
      ['Esc', 'Save and close (in a message)'],
      ['/ then name', 'Insert a template (in a message)'],
      ['; / :', 'Expand / collapse all messages'],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsHelp);
  const enabled = useSettings((s) => s.keyboardShortcuts);
  return (
    <Dialog open={open} onOpenChange={(o) => useUi.getState().set({ shortcutsHelp: o })} title="Keyboard shortcuts" size="large" closable>
      <label className="shortcuts__toggle">
        <span className="md-body-large">Keyboard shortcuts</span>
        <Switch checked={enabled} onCheckedChange={(v) => updateSettings({ keyboardShortcuts: v })} label="Keyboard shortcuts" />
      </label>
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title} className="shortcuts__group">
            <h3 className="md-title-small shortcuts__title">{g.title}</h3>
            <dl>
              {g.items.map(([k, label]) => (
                <div key={k + label} className="shortcuts__row">
                  <dt>
                    {k.split(/( then | \/ | or )/).map((part, i) =>
                      / then | \/ | or /.test(part) ? (
                        <span key={i} className="shortcuts__sep">
                          {part.trim()}
                        </span>
                      ) : (
                        <kbd key={i}>{keyLabel(part)}</kbd>
                      ),
                    )}
                  </dt>
                  <dd className="md-body-medium">{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
