import { useEffect, useState } from 'react';
import type { Template } from '../../state/settings';
import { Icon } from '../../ui/Icon';
import { isComposing } from '../../lib/ime';

/** The "/" quick-insert list that appears while typing a template shortcut. */
export function TemplatePicker({ id, templates, onPick, onClose }: { id: string; templates: Template[]; onPick: (t: Template) => void; onClose: () => void }) {
  const [active, setActive] = useState(0);
  const [activeFor, setActiveFor] = useState(templates.length);
  if (activeFor !== templates.length) {
    setActiveFor(templates.length);
    setActive(0);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An input method's Enter, Tab and arrows pick its own candidates.
      if (isComposing(e)) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => (a + 1) % templates.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => (a - 1 + templates.length) % templates.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        onPick(templates[active]);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [templates, active, onPick, onClose]);
  return (
    <ul className="template-picker" role="listbox" aria-label="Templates" id={id}>
      {templates.map((t, i) => (
        <li
          key={t.id}
          role="option"
          id={i === active ? `${id}-active` : undefined}
          aria-selected={i === active}
          className="template-picker__item"
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t);
          }}
          onMouseEnter={() => setActive(i)}
        >
          <Icon name="text_snippet" size={20} />
          <span className="md-body-medium">{t.name}</span>
          <span className="md-label-medium template-picker__key">/{t.shortcut}</span>
        </li>
      ))}
    </ul>
  );
}
