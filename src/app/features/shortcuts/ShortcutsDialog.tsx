import { useState, type KeyboardEvent } from 'react';
import { useUi } from '../../state/ui';
import { updateSettings, useSettings } from '../../state/settings';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Ripple } from '../../ui/Ripple';
import { Switch } from '../../ui/Switch';
import { keyLabel } from '../../ui/keys';
import { SHORTCUT_ACTIONS, assignKey, isBindable, keyMap, keyName, keysFor, resetKey, type ShortcutGroup } from './bindings';

/** A fixed row, or an action whose key can be changed (with a fixed alternative like Enter). */
type Item = { keys: string; label: string } | { action: string; also?: string };

const ACTION = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));
const actions = (group: ShortcutGroup) => SHORTCUT_ACTIONS.filter((a) => a.group === group).map((a): Item => ({ action: a.id, also: ALSO[a.id] }));
const ALSO: Record<string, string> = { open: 'Enter', back: 'Esc' };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Jump around',
    items: [
      { keys: 'Ctrl K', label: 'Command palette' },
      ...actions('jump'),
      { keys: 'g then i', label: 'Go to Inbox' },
      { keys: 'g then s', label: 'Go to Starred' },
      { keys: 'g then b', label: 'Go to Snoozed' },
      { keys: 'g then t', label: 'Go to Sent' },
      { keys: 'g then d', label: 'Go to Drafts' },
      { keys: 'g then a', label: 'Go to All mail' },
      { keys: 'g then k', label: 'Go to Follow-ups' },
      { keys: 'g then r', label: 'Work through Reply later' },
      { keys: 'g then 0', label: 'Open All inboxes' },
      { keys: 'g then 1 to 9', label: 'Switch to your first to ninth account' },
    ],
  },
  {
    title: 'In the list',
    items: [
      ...actions('list'),
      { keys: '* then a', label: 'Select all' },
      { keys: '* then n', label: 'Select none' },
      { keys: '* then u', label: 'Select unread' },
    ],
  },
  { title: 'Act on conversations', items: actions('act') },
  {
    title: 'Write',
    items: [
      ...actions('write'),
      { keys: 'Ctrl Enter', label: 'Send' },
      { keys: 'Ctrl Shift Enter', label: 'Schedule send' },
      { keys: 'Ctrl K', label: 'Insert link (in a message)' },
      { keys: 'Ctrl Shift C / Ctrl Shift B', label: 'Add Cc / Bcc (in a message)' },
      { keys: 'Esc', label: 'Save and close (in a message)' },
      { keys: '/ then name', label: 'Insert a template (in a message)' },
    ],
  },
];

const SEP = / then | \/ | or /;

function Keys({ keys }: { keys: string }) {
  return keys.split(/( then | \/ | or )/).map((part, i) =>
    SEP.test(part) ? (
      <span key={i} className="shortcuts__sep">
        {part.trim()}
      </span>
    ) : (
      <kbd key={i}>{keyLabel(part)}</kbd>
    ),
  );
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsHelp);
  const enabled = useSettings((s) => s.keyboardShortcuts);
  const custom = useSettings((s) => s.shortcutKeys);
  const [editing, setEditing] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [said, setSaid] = useState('');
  const changed = Object.keys(custom).length > 0;

  const stopEditing = () => {
    setEditing(null);
    setRefused(false);
  };

  const choose = (id: string, key: string) => {
    const owner = key ? keyMap(custom).get(key) : undefined;
    const next = assignKey(custom, id, key);
    updateSettings({ shortcutKeys: next });
    const label = ACTION.get(id)!.label;
    const lost = owner && owner !== id && !keysFor(owner, next).length ? ` ${ACTION.get(owner)!.label} has no key now.` : '';
    setSaid(key ? `${label}: ${keyName(key)}.${lost}` : `${label} has no key now.`);
    stopEditing();
  };

  const onCapture = (id: string, e: KeyboardEvent<HTMLButtonElement>) => {
    if (editing !== id || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') return;
    // Every other key is the answer, so none of them reaches the dialog (Esc would close it).
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stopEditing();
    if (e.key === 'Backspace' || e.key === 'Delete') return choose(id, '');
    if (isBindable(e.key)) return choose(id, e.key);
    // g and * start sequences; Shift, Enter and arrows aren't keys a shortcut can be.
    if (e.key === 'g' || e.key === '*') setRefused(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        stopEditing();
        useUi.getState().set({ shortcutsHelp: o });
      }}
      title="Keyboard shortcuts"
      size="large"
      closable
    >
      <div className="shortcuts__toggle">
        <label className="shortcuts__toggle-label md-body-large" htmlFor="shortcuts-on">
          Keyboard shortcuts
        </label>
        {changed && (
          <Button
            variant="text"
            icon="undo"
            onClick={() => {
              updateSettings({ shortcutKeys: {} });
              setSaid("Gmail's keys are back.");
              stopEditing();
            }}
          >
            Reset keys
          </Button>
        )}
        <Switch id="shortcuts-on" checked={enabled} onCheckedChange={(v) => updateSettings({ keyboardShortcuts: v })} label="Keyboard shortcuts" />
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title} className="shortcuts__group">
            <h3 className="md-title-small shortcuts__title">{g.title}</h3>
            <dl>
              {g.items.map((item) => {
                if ('keys' in item) {
                  return (
                    <div key={item.keys + item.label} className="shortcuts__row">
                      <dt>
                        <Keys keys={item.keys} />
                      </dt>
                      <dd className="md-body-medium">{item.label}</dd>
                    </div>
                  );
                }
                const a = ACTION.get(item.action)!;
                const now = keysFor(a.id, custom).map(keyName);
                const isEditing = editing === a.id;
                return (
                  <div key={a.id} className="shortcuts__row">
                    <dt>
                      <button
                        type="button"
                        className="shortcuts__key"
                        data-editing={isEditing || undefined}
                        disabled={!enabled}
                        aria-label={isEditing ? `Press a key for ${a.label}` : `Change the key for ${a.label}, now ${now.join(' or ') || 'none'}`}
                        onClick={() => {
                          stopEditing();
                          if (!isEditing) setEditing(a.id);
                        }}
                        onKeyDown={(e) => onCapture(a.id, e)}
                        onBlur={() => isEditing && stopEditing()}
                      >
                        {isEditing ? (
                          <span className="md-label-large">{refused ? 'Not g or *' : 'Press a key'}</span>
                        ) : now.length ? (
                          <Keys keys={now.join(' / ')} />
                        ) : (
                          <span className="md-label-large shortcuts__none">None</span>
                        )}
                        <Ripple disabled={!enabled} />
                      </button>
                      {item.also && !isEditing && (
                        <>
                          <span className="shortcuts__sep">or</span>
                          <kbd>{item.also}</kbd>
                        </>
                      )}
                    </dt>
                    <dd className="md-body-medium">{a.label}</dd>
                    {a.id in custom && (
                      <IconButton
                        icon="undo"
                        size="xs"
                        className="shortcuts__reset"
                        label={`Use ${a.keys.map(keyName).join(' / ')} for ${a.label}`}
                        tooltip={`Use ${a.keys.map(keyName).join(' / ')}`}
                        onClick={() => {
                          const next = resetKey(custom, a.id);
                          updateSettings({ shortcutKeys: next });
                          setSaid(`${a.label}: ${keysFor(a.id, next).map(keyName).join(' / ') || 'no key'}.`);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
