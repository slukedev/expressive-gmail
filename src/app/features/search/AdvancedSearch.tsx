import { useEffect, useRef, useState } from 'react';
import { backend, keys, queryClient } from '../../data/client';
import { Button, IconButton } from '../../ui/Button';
import { snack } from '../../ui/Snackbar';
import { Select } from '../../ui/Select';
import { Checkbox } from '../../ui/Checkbox';
import { TextField } from '../../ui/TextField';
import { DateField } from '../../ui/DatePicker';
import { buildAdvancedQuery, EMPTY_ADVANCED, getOperator, type AdvancedSearch } from './query';

const WITHIN = [
  ['1d', '1 day'],
  ['3d', '3 days'],
  ['1w', '1 week'],
  ['2w', '2 weeks'],
  ['1m', '1 month'],
  ['2m', '2 months'],
  ['6m', '6 months'],
  ['1y', '1 year'],
];
const SCOPES = [
  ['all', 'All mail'],
  ['in:inbox', 'Inbox'],
  ['is:starred', 'Starred'],
  ['in:sent', 'Sent mail'],
  ['in:drafts', 'Drafts'],
  ['in:anywhere', 'Mail, Spam and Trash'],
  ['is:read', 'Read mail'],
  ['is:unread', 'Unread mail'],
];

/** Gmail's "Show search options", as an M3 card under the search bar. */
export function AdvancedSearchPanel({ onClose, onSearch, initialFrom }: { onClose: () => void; onSearch: (q: string) => void; initialFrom: string }) {
  const [a, setA] = useState<AdvancedSearch>({ ...EMPTY_ADVANCED, from: getOperator(initialFrom, 'from') ?? '', words: initialFrom.includes(':') ? '' : initialFrom });
  const ref = useRef<HTMLFormElement>(null);
  const set = <K extends keyof AdvancedSearch>(k: K, v: AdvancedSearch[K]) => setA((x) => ({ ...x, [k]: v }));
  const query = buildAdvancedQuery(a);
  const canFilter = !!backend().createFilter && (a.from || a.to || a.subject || a.words);

  // Through a ref: the search bar passes a new function every render, and re-running the effects below would pull focus back to the first field mid-typing.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      // Its own menus and the date picker open in portals; they're still part of the form.
      if (!ref.current?.contains(t) && !t.closest('.search__bar, .m3-menu-positioner, .m3-dialog, .m3-scrim')) close.current();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  const createFilter = async () => {
    try {
      await backend().createFilter!({
        criteria: { from: a.from || undefined, to: a.to || undefined, subject: a.subject || undefined, query: a.words || undefined, negatedQuery: a.without || undefined, hasAttachment: a.hasAttachment || undefined },
        action: { removeLabelIds: ['INBOX'] },
      });
      void queryClient.invalidateQueries({ queryKey: keys.allThreads });
      snack('Filter created: matching mail skips the inbox');
      onClose();
    } catch (err) {
      snack(err instanceof Error ? err.message : "Couldn't create the filter.");
    }
  };

  return (
    <form
      ref={ref}
      className="advanced-search"
      aria-label="Search options"
      onSubmit={(e) => {
        e.preventDefault();
        if (query) onSearch(query);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Escape inside an open menu or date picker closes only that, even one whose focus hasn't moved in yet.
        const layerOpen = !!document.querySelector('.m3-datepicker, .m3-menu-positioner');
        if (e.key === 'Escape' && !layerOpen && ref.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div className="advanced-search__head">
        <h2 className="md-title-medium">Search options</h2>
        <IconButton icon="close" label="Close search options" size="xs" onClick={onClose} />
      </div>
      {(
        [
          ['from', 'From'],
          ['to', 'To'],
          ['subject', 'Subject'],
          ['words', 'Has the words'],
          ['without', "Doesn't have"],
        ] as const
      ).map(([k, label]) => (
        <TextField key={k} label={label} value={a[k]} className={k === 'subject' ? 'adv-span' : undefined} onChange={(e) => set(k, e.target.value)} />
      ))}
      <div className="adv-inline">
        <Select below label="Size comparison" fieldLabel="Size" value={a.sizeOp} onChange={(v) => set('sizeOp', v)} options={[['larger', 'Greater than'], ['smaller', 'Less than']]} />
        <TextField label="Amount" inputMode="numeric" value={a.size} onChange={(e) => set('size', e.target.value.replace(/\D/g, ''))} />
        <Select below label="Size unit" fieldLabel="Unit" value={a.sizeUnit} onChange={(v) => set('sizeUnit', v)} options={[['M', 'MB'], ['K', 'KB']]} />
      </div>
      <div className="adv-inline">
        <Select below label="Date range" fieldLabel="Date within" value={a.within} onChange={(v) => set('within', v)} options={WITHIN as [string, string][]} />
        <DateField label="Of" value={a.date} onChange={(v) => set('date', v)} />
        <Select below label="Search in" fieldLabel="Search in" value={a.scope} onChange={(v) => set('scope', v)} options={SCOPES as [string, string][]} />
      </div>
      <div className="adv-check">
        <Checkbox checked={a.hasAttachment} onCheckedChange={(v) => set('hasAttachment', v)} label="Has attachment" />
        <span className="md-body-medium" aria-hidden="true" onClick={() => set('hasAttachment', !a.hasAttachment)}>
          Has attachment
        </span>
      </div>
      <div className="advanced-search__actions">
        {canFilter && (
          <Button variant="text" onClick={() => void createFilter()}>
            Create filter
          </Button>
        )}
        <Button variant="filled" type="submit" disabled={!query}>
          Search
        </Button>
      </div>
    </form>
  );
}
