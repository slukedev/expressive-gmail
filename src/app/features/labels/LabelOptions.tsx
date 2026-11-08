import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useState } from 'react';
import { backend, keys, queryClient } from '../../data/client';
import type { Label } from '../../data/types';
import { labelDotColor } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Menu, MenuItem, MenuSeparator, Submenu } from '../../ui/Menu';
import { snack } from '../../ui/Snackbar';
import { LABEL_COLORS } from './LabelEditor';

type Patch = Parameters<ReturnType<typeof backend>['updateLabel']>[1];

async function update(label: Label, patch: Patch, done: string, undo?: Patch) {
  try {
    await backend().updateLabel(label.id, patch);
    await queryClient.invalidateQueries({ queryKey: keys.labels });
    snack(done, undo ? { action: { label: 'Undo', onClick: () => void update(label, undo, 'Action undone') } } : {});
  } catch {
    snack(`Couldn't change “${label.name}”.`);
  }
}

/** Conversations keep everything else. */
function RemoveLabelDialog({ label, onClose }: { label: Label | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!label}
      onOpenChange={(o) => !o && onClose()}
      title={`Remove “${label?.name}”?`}
      description="Conversations keep everything else; they just lose this label."
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="text"
            onClick={async () => {
              const l = label!;
              onClose();
              try {
                await backend().deleteLabel(l.id);
                void queryClient.invalidateQueries({ queryKey: keys.labels });
                snack(`Label “${l.name}” removed`);
              } catch {
                snack(`Couldn't remove “${l.name}”.`);
              }
            }}
          >
            Remove
          </Button>
        </>
      }
    />
  );
}

/** Gmail web's label menu, from the ⋮ on a rail label or a right click. */
export function LabelOptions({
  label,
  open,
  onOpenChange,
  onEdit,
  onAddSublabel,
}: {
  label: Label;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (label: Label) => void;
  onAddSublabel: (parent: string) => void;
}) {
  const dark = useResolvedDark();
  const [removing, setRemoving] = useState<Label | null>(null);
  const current = label.color?.background;
  return (
    <>
      <Menu
        open={open}
        onOpenChange={onOpenChange}
        align="start"
        trigger={<IconButton icon="more_vert" label={`Options for ${label.name}`} size="xs" className="rail-label__more" />}
      >
        <Submenu icon="palette" label="Label color">
          {LABEL_COLORS.map(([hex, name]) => (
            <BaseMenu.Item
              key={hex}
              className="m3-menu-item"
              aria-label={current === hex ? `${name}, current` : name}
              onClick={() => void update(label, { color: { background: hex, text: '#ffffff' } }, `Label color changed`, { color: label.color })}
            >
              <Icon name="label" size={20} filled className="m3-menu-item__icon" style={{ color: labelDotColor(hex, dark) }} />
              <span className="m3-menu-item__text">
                <span className="m3-menu-item__label">{name}</span>
              </span>
              {current === hex && <Icon name="check" size={20} className="m3-menu-item__trailing-icon" />}
            </BaseMenu.Item>
          ))}
          <MenuSeparator />
          <MenuItem icon="format_color_reset" disabled={!current} onClick={() => void update(label, { color: undefined }, 'Label color removed', { color: label.color })}>
            No color
          </MenuItem>
        </Submenu>
        <MenuItem icon="edit" onClick={() => onEdit(label)}>
          Edit
        </MenuItem>
        <MenuItem icon="new_label" onClick={() => onAddSublabel(label.name)}>
          Add sublabel
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="visibility_off" onClick={() => void update(label, { hidden: true }, `“${label.name}” hidden from the menu`, { hidden: false })}>
          Hide from menu
        </MenuItem>
        <MenuItem icon="label_off" danger onClick={() => setRemoving(label)}>
          Remove label
        </MenuItem>
      </Menu>
      <RemoveLabelDialog label={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
