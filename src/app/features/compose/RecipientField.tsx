import { useId, useRef, useState } from 'react';
import { fold, knownName, useContactSuggestions } from '../../data/contacts';
import type { Address, Contact } from '../../data/types';
import { EMAIL_RE, parseAddresses } from '../../lib/format';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';
import { cx } from '../../ui/Button';
import { isComposing } from '../../lib/ime';

/** The part `query` matched (the start, or of a later word) in bold, as Gmail shows it. */
function Matched({ text, query }: { text: string; query: string }) {
  const q = fold(query.trim());
  if (!q) return <>{text}</>;
  for (const m of text.matchAll(/[^\s._+'@-]+/g)) {
    const word = m[0];
    if (!fold(word).startsWith(q)) continue;
    let end = 1;
    while (end < word.length && fold(word.slice(0, end)).length < q.length) end++;
    const start = m.index;
    return (
      <>
        {text.slice(0, start)}
        <strong className="recipients__match">{text.slice(start, start + end)}</strong>
        {text.slice(start + end)}
      </>
    );
  }
  return <>{text}</>;
}

/** Chips with autocomplete, paste of many addresses, and keyboard editing. */
export function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
  trailing,
}: {
  label: string;
  value: Address[];
  onChange: (v: Address[]) => void;
  autoFocus?: boolean;
  trailing?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const contacts = useContactSuggestions(text);
  const existing = new Set(value.map((a) => a.email.toLowerCase()));
  const suggestions = text.trim() ? contacts.filter((c) => !existing.has(c.email.toLowerCase())).slice(0, 6) : [];

  const [activeFor, setActiveFor] = useState(text);
  if (activeFor !== text) {
    setActiveFor(text);
    setActive(0);
  }
  // A late answer can shorten the list under the highlight.
  const current = Math.min(active, Math.max(suggestions.length - 1, 0));
  const expanded = open && suggestions.length > 0;
  const optionId = (i: number) => `${listId}-${i}`;

  const commit = (raw = text) => {
    const parsed = parseAddresses(raw);
    const fallback: Address[] = raw.trim() && !parsed.length ? [{ email: raw.trim().replace(/[,;]$/, '') }] : [];
    const add = [...parsed, ...fallback]
      .filter((a) => !existing.has(a.email.toLowerCase()))
      // A typed address of someone known gets their name on the chip, as in Gmail.
      .map((a) => {
        const name = a.name || knownName(a.email, contacts);
        return name ? { ...a, name } : a;
      });
    if (add.length) onChange([...value, ...add]);
    setText('');
  };

  const pick = (c: Contact) => {
    onChange([...value, { name: c.name, email: c.email }]);
    setText('');
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="recipients" onClick={() => inputRef.current?.focus()}>
      <span className="recipients__label">{label}</span>
      <div className="recipients__chips">
        {value.map((a, i) => {
          const invalid = !EMAIL_RE.test(a.email);
          return (
            <Tooltip key={`${a.email}-${i}`} content={invalid ? 'This email address isn’t valid' : a.email}>
              <span className={cx('recipient-chip', invalid && 'recipient-chip--invalid')}>
                <Avatar name={a.name} email={a.email} size={24} />
                <span className="recipient-chip__name">{a.name || a.email}</span>
                <button
                  type="button"
                  className="recipient-chip__remove"
                  aria-label={`Remove ${a.name || a.email}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((_, j) => j !== i));
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </span>
            </Tooltip>
          );
        })}
        <input
          ref={inputRef}
          className="recipients__input"
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded ? optionId(current) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v) && v.trim().length > 1) commit(v);
            else {
              setText(v);
              setOpen(true);
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (parseAddresses(pasted).length > 1) {
              e.preventDefault();
              commit(pasted);
            }
          }}
          onBlur={() => {
            // Closes after a click on an option lands; not if focus came back meanwhile.
            window.setTimeout(() => {
              if (document.activeElement !== inputRef.current) setOpen(false);
            }, 120);
            if (text.trim()) commit();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            // An input method's Enter, Tab and arrows pick its own candidates.
            if (isComposing(e)) return;
            if (open && suggestions.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((current + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((current - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(suggestions[current]!);
                return;
              }
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      </div>
      {trailing}
      {expanded && (
        <ul className="recipients__menu" id={listId} role="listbox">
          {suggestions.map((c, i) => (
            <li
              key={c.email}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className="recipients__option"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar name={c.name} email={c.email} photoUrl={c.photoUrl} size={32} />
              <span className="recipients__option-text">
                <span className="md-body-medium recipients__option-line">
                  <Matched text={c.name || c.email} query={text} />
                </span>
                {c.name && (
                  <span className="md-body-small recipients__option-email recipients__option-line">
                    <Matched text={c.email} query={text} />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
