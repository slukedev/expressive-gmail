import { Popover } from '@base-ui/react/popover';
import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';
import { EMOJI, emojiName, searchEmoji } from './emoji';
import { rememberEmoji, useComposeData } from './signatures';

const COLUMNS = 8;

/** Arrow keys walk the grid; Enter or Space picks. */
function gridKeys(e: KeyboardEvent<HTMLDivElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.emoji-picker__item')];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
  if (!(e.key in moves)) return;
  e.preventDefault();
  const next = Math.min(items.length - 1, Math.max(0, at + moves[e.key]));
  items[next]?.focus();
}

/** A search field, recent picks, then the groups. */
export function EmojiPicker({
  open,
  onOpenChange,
  onPick,
  anchor,
  withTrigger = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  anchor?: RefObject<Element | null>;
  withTrigger?: boolean;
}) {
  const [query, setQuery] = useState('');
  const recent = useComposeData((s) => s.recentEmoji);
  const search = useRef<HTMLInputElement>(null);
  const found = useMemo(() => searchEmoji(query), [query]);
  const pick = (emoji: string) => {
    useComposeData.getState().update((d) => rememberEmoji(d, emoji));
    onPick(emoji);
    onOpenChange(false);
  };
  const cell = (e: string) => (
    <button key={e} type="button" className="emoji-picker__item" aria-label={emojiName(e)} title={emojiName(e)} onClick={() => pick(e)}>
      {e}
    </button>
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery('');
      }}
    >
      {withTrigger && (
        <Tooltip content="Insert emoji">
          <Popover.Trigger className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default" aria-label="Insert emoji" data-popup-open={open || undefined}>
            <Icon name="mood" size={24} />
          </Popover.Trigger>
        </Tooltip>
      )}
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={8} anchor={anchor} className="m3-menu-positioner">
          <Popover.Popup className="emoji-picker" initialFocus={search} aria-label="Emoji">
            <div className="emoji-picker__search">
              <Icon name="search" size={20} />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search emoji"
                aria-label="Search emoji"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (found[0]) pick(found[0]);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    e.currentTarget.closest('.emoji-picker')?.querySelector<HTMLButtonElement>('.emoji-picker__item')?.focus();
                  } else if (e.key === 'Escape') {
                    onOpenChange(false);
                  }
                }}
              />
            </div>
            <div className="emoji-picker__scroll" onKeyDown={gridKeys}>
              {query ? (
                found.length ? (
                  <div className="emoji-picker__grid" role="group" aria-label="Results">
                    {found.map(cell)}
                  </div>
                ) : (
                  <p className="emoji-picker__empty md-body-medium">No emoji match “{query}”</p>
                )
              ) : (
                <>
                  {recent.length > 0 && (
                    <section aria-label="Used lately">
                      <h3 className="emoji-picker__title md-label-large">Used lately</h3>
                      <div className="emoji-picker__grid">{recent.slice(0, COLUMNS * 2).map(cell)}</div>
                    </section>
                  )}
                  {EMOJI.map((g) => (
                    <section key={g.name} aria-label={g.name}>
                      <h3 className="emoji-picker__title md-label-large">{g.name}</h3>
                      <div className="emoji-picker__grid">{g.items.map(([e]) => cell(e))}</div>
                    </section>
                  ))}
                </>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
