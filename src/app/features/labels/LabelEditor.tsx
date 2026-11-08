import { useEffect, useState } from 'react';
import { backend, keys, queryClient } from '../../data/client';
import { useLabels } from '../../data/hooks';
import type { Label } from '../../data/types';
import { snack } from '../../ui/Snackbar';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { TextField } from '../../ui/TextField';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { labelChipColors } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';

/** A representative subset of Gmail's allowed backgrounds, with names for screen readers. */
export const LABEL_COLORS: [string, string][] = [
  ['#fb4c2f', 'Red'],
  ['#ffad47', 'Orange'],
  ['#fad165', 'Yellow'],
  ['#16a766', 'Green'],
  ['#43d692', 'Mint'],
  ['#4a86e8', 'Blue'],
  ['#a479e2', 'Purple'],
  ['#f691b3', 'Pink'],
  ['#999999', 'Gray'],
  ['#2da2bb', 'Teal'],
];
const COLORS = LABEL_COLORS.map(([c]) => c);
const colorName = (c: string) => LABEL_COLORS.find(([x]) => x === c)?.[1] ?? c;

export function LabelEditor({
  state,
  onClose,
  onCreated,
}: {
  state: { open: boolean; label?: Label; parent?: string; initialName?: string };
  onClose: () => void;
  onCreated?: (label: Label) => void;
}) {
  const { data: labels = [] } = useLabels();
  const dark = useResolvedDark();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [color, setColor] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const editing = state.label;

  useEffect(() => {
    if (!state.open) return;
    const full = editing?.name ?? state.initialName ?? '';
    const parts = full.split('/');
    setName(editing ? parts.pop()! : full);
    setParent(editing ? parts.join('/') : (state.parent ?? ''));
    setColor(editing?.color?.background);
  }, [state.open, editing, state.parent, state.initialName]);

  const fullName = parent ? `${parent}/${name.trim()}` : name.trim();
  const duplicate = labels.some((l) => l.name.toLowerCase() === fullName.toLowerCase() && l.id !== editing?.id);
  const parents = labels.filter((l) => l.type === 'user' && l.id !== editing?.id);

  const save = async () => {
    if (!name.trim() || duplicate) return;
    setSaving(true);
    try {
      const value = { name: fullName, color: color ? { background: color, text: '#ffffff' } : undefined };
      const label = editing ? await backend().updateLabel(editing.id, value) : await backend().createLabel(value);
      await queryClient.invalidateQueries({ queryKey: keys.labels });
      snack(editing ? `Label "${label.name}" saved` : `Label "${label.name}" created`);
      onCreated?.(label);
      onClose();
    } catch (err) {
      snack(err instanceof Error ? err.message : "Couldn't save the label.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={state.open}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? 'Edit label' : 'New label'}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="text" disabled={!name.trim() || duplicate || saving} onClick={() => void save()}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Label name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value.replace(/\//g, ''))}
          error={duplicate ? 'A label with this name already exists.' : undefined}
          maxLength={225}
        />
        <Select
          label="Nest under"
          fieldLabel="Nest under"
          value={parent}
          onChange={setParent}
          options={[['', 'No parent label'], ...parents.map((l) => [l.name, l.name] as [string, string])]}
        />
        <fieldset className="swatches">
          <legend className="md-body-small">Color</legend>
          <button type="button" className="swatch swatch--none" aria-pressed={!color} onClick={() => setColor(undefined)} aria-label="No color">
            <Icon name="block" size={18} />
          </button>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              aria-pressed={color === c}
              aria-label={colorName(c)}
              style={{ background: labelChipColors(c, dark).bg, color: labelChipColors(c, dark).fg }}
              onClick={() => setColor(c)}
            >
              {color === c && <Icon name="check" size={18} weight={500} />}
            </button>
          ))}
        </fieldset>
      </form>
    </Dialog>
  );
}
