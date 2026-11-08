import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useMemo, useState, type ReactElement } from 'react';
import { mail } from '../../data/actions';
import { snapshotThreads } from '../../data/client';
import { useLabels } from '../../data/hooks';
import type { LabelId } from '../../data/types';
import { labelDotColor } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/Icon';
import { MenuItem, MenuPopup, MenuSeparator, Submenu } from '../../ui/Menu';
import { LabelEditor } from './LabelEditor';

/** "Label as" (toggles, applied on close like Gmail) and "Move to" (one label, out of Inbox). Filterable by typing. */
export function LabelMenu({
  ids,
  mode,
  trigger,
}: {
  ids: string[];
  mode: 'label' | 'move';
  trigger: ReactElement<Record<string, unknown>>;
}) {
  const { data: labels = [] } = useLabels();
  const dark = useResolvedDark();
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<Map<LabelId, boolean>>(new Map());
  const [creating, setCreating] = useState(false);

  const userLabels = useMemo(
    () =>
      labels
        .filter((l) => l.type === 'user' && !l.name.startsWith('['))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [labels],
  );
  const shown = userLabels.filter((l) => l.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const current = (id: LabelId) => {
    if (pending.has(id)) return pending.get(id)!;
    const threads = [...snapshotThreads(ids).values()];
    return threads.length > 0 && threads.every((t) => t.labelIds.includes(id));
  };

  const commit = () => {
    if (!pending.size) return;
    const add = [...pending].filter(([, on]) => on).map(([id]) => id);
    const remove = [...pending].filter(([, on]) => !on).map(([id]) => id);
    const names = (list: LabelId[]) => list.map((id) => labels.find((l) => l.id === id)?.name).join(', ');
    const message = add.length && !remove.length ? `Label "${names(add)}" added` : remove.length && !add.length ? `Label "${names(remove)}" removed` : 'Labels updated';
    void mail.addLabels(ids, add, remove, message);
    setPending(new Map());
  };

  return (
    <>
      <BaseMenu.Root
        onOpenChange={(open) => {
          if (!open) {
            if (mode === 'label') commit();
            setFilter('');
          }
        }}
      >
        <BaseMenu.Trigger render={trigger} />
        <MenuPopup align="end" className="label-menu">
          <div className="label-menu__head">
            <span className="md-label-large label-menu__title">{mode === 'move' ? 'Move to' : 'Label as'}</span>
            <label className="label-menu__search">
              <Icon name="search" size={20} />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') e.stopPropagation();
                }}
                placeholder="Search labels"
                aria-label="Search labels"
              />
            </label>
          </div>
          <div className="label-menu__list">
            {mode === 'move' && !filter && (
              <>
                <MenuItem icon="inbox" onClick={() => void mail.moveToInbox(ids)}>Inbox</MenuItem>
                <MenuItem icon="report" onClick={() => void mail.spam(ids)}>Spam</MenuItem>
                <MenuItem icon="delete" onClick={() => void mail.trash(ids)}>Trash</MenuItem>
                {userLabels.length > 0 && <MenuSeparator />}
              </>
            )}
            {shown.map((l) => {
              // Same mark as the rail.
              const color = l.color ? labelDotColor(l.color.background, dark) : undefined;
              const parts = l.name.split('/');
              const depth = filter ? 0 : parts.length - 1;
              const name = filter ? l.name : parts[depth];
              const indent = depth ? { paddingInlineStart: `calc(12px + ${depth * 16}px)` } : undefined;
              if (mode === 'move') {
                return (
                  <BaseMenu.Item key={l.id} className="m3-menu-item" style={indent} aria-label={l.name} onClick={() => void mail.moveTo(ids, l.id, l.name)}>
                    <Icon name="label" size={20} filled={!!color} className="m3-menu-item__icon" style={color ? { color } : undefined} />
                    <span className="m3-menu-item__text">
                      <span className="m3-menu-item__label">{name}</span>
                    </span>
                  </BaseMenu.Item>
                );
              }
              const on = current(l.id);
              return (
                <BaseMenu.CheckboxItem
                  key={l.id}
                  className="m3-menu-item"
                  style={indent}
                  aria-label={l.name}
                  checked={on}
                  closeOnClick={false}
                  onCheckedChange={(checked) => setPending((p) => new Map(p).set(l.id, checked))}
                >
                  <span className="m3-menu-lead" data-checked={on || undefined} data-has-icon="">
                    <Icon name="label" size={20} filled={!!color} className="m3-menu-item__icon m3-menu-lead__icon" style={color ? { color } : undefined} />
                    <Icon name="check" size={20} className="m3-menu-lead__check" />
                  </span>
                  <span className="m3-menu-item__text">
                    <span className="m3-menu-item__label">{name}</span>
                  </span>
                </BaseMenu.CheckboxItem>
              );
            })}
            {shown.length === 0 && filter && <p className="label-menu__empty md-body-medium">No labels match “{filter}”</p>}
          </div>
          <MenuSeparator />
          <MenuItem icon="new_label" onClick={() => setCreating(true)}>
            {filter ? `Create “${filter}”` : 'Create new label'}
          </MenuItem>
        </MenuPopup>
      </BaseMenu.Root>
      <LabelEditor
        state={{ open: creating, initialName: filter }}
        onClose={() => setCreating(false)}
        onCreated={(label) => (mode === 'move' ? void mail.moveTo(ids, label.id, label.name) : void mail.addLabels(ids, [label.id], [], `Label "${label.name}" added`))}
      />
    </>
  );
}

/** For another menu (the phone selection toolbar's overflow). A label toggles as soon as it's picked. */
export function LabelSubmenu({ ids, mode, onDone }: { ids: string[]; mode: 'label' | 'move'; onDone?: () => void }) {
  const { data: labels = [] } = useLabels();
  const dark = useResolvedDark();
  const userLabels = labels
    .filter((l) => l.type === 'user' && !l.name.startsWith('['))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const threads = [...snapshotThreads(ids).values()];
  return (
    <Submenu icon={mode === 'move' ? 'drive_file_move' : 'label'} label={mode === 'move' ? 'Move to' : 'Labels'}>
      {userLabels.length === 0 && <p className="label-menu__empty md-body-medium">No labels yet</p>}
      {userLabels.map((l) => {
        const color = l.color ? labelDotColor(l.color.background, dark) : undefined;
        const parts = l.name.split('/');
        const depth = parts.length - 1;
        const indent = depth ? { paddingInlineStart: `calc(12px + ${depth * 16}px)` } : undefined;
        const on = threads.length > 0 && threads.every((t) => t.labelIds.includes(l.id));
        return (
          <BaseMenu.Item
            key={l.id}
            className="m3-menu-item"
            style={indent}
            aria-label={mode === 'label' && on ? `${l.name}, applied` : l.name}
            onClick={() => {
              if (mode === 'move') void mail.moveTo(ids, l.id, l.name);
              else void mail.addLabels(ids, on ? [] : [l.id], on ? [l.id] : [], on ? `Label "${l.name}" removed` : `Label "${l.name}" added`);
              onDone?.();
            }}
          >
            <Icon name="label" size={20} filled={!!color} className="m3-menu-item__icon" style={color ? { color } : undefined} />
            <span className="m3-menu-item__text">
              <span className="m3-menu-item__label">{parts[depth]}</span>
            </span>
            {mode === 'label' && on && <Icon name="check" size={20} className="m3-menu-item__trailing-icon" />}
          </BaseMenu.Item>
        );
      })}
    </Submenu>
  );
}
