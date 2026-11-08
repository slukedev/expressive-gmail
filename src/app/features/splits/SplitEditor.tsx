import { useEffect, useState } from 'react';
import { navigate } from '../../router/useRoute';
import { updateSettings, type Split } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Dialog } from '../../ui/Dialog';
import { TextField } from '../../ui/TextField';

const IDEAS: [string, string][] = [
  ['VIP', 'is:important is:unread'],
  ['Team', 'from:@example.com'],
  ['Newsletters', 'category:promotions OR list:*'],
  ['Calendar', 'filename:ics OR subject:invitation'],
  ['Needs reply', 'in:inbox -from:me is:unread'],
];

export function SplitEditor({ open, split, onClose }: { open: boolean; split?: Split; onClose: () => void }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) {
      setName(split?.name ?? '');
      setQuery(split?.query ?? '');
    }
  }, [open, split]);
  const valid = name.trim() && query.trim();
  const save = () => {
    if (!valid) return;
    const s: Split = { id: split?.id ?? crypto.randomUUID().slice(0, 8), name: name.trim(), query: query.trim(), icon: split?.icon ?? 'filter_alt' };
    updateSettings((st) => ({ splits: split ? st.splits.map((x) => (x.id === s.id ? s : x)) : [...st.splits, s] }));
    onClose();
    navigate({ view: { kind: 'split', id: s.id } });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={split ? 'Edit split' : 'New split'}
      description="A split is a saved search that gets its own place in the menu."
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="text" disabled={!valid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} maxLength={40} />
        <TextField label="Search" value={query} onChange={(e) => setQuery(e.target.value)} supporting="Any Gmail search works, like from:, label:, has:attachment" />
        {!split && (
          <div className="idea-chips" aria-label="Ideas">
            {IDEAS.map(([n, q]) => (
              <Chip key={n} kind="suggestion" onClick={() => (setName(n), setQuery(q))}>
                {n}
              </Chip>
            ))}
          </div>
        )}
      </form>
    </Dialog>
  );
}
