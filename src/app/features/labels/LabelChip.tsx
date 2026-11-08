import type { Label } from '../../data/types';
import { labelChipColors } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/Icon';

/** Gmail's "Inbox" chip in M3 Expressive. */
export function LabelChip({ label, onRemove }: { label: Pick<Label, 'id' | 'name' | 'color'>; onRemove?: () => void }) {
  const dark = useResolvedDark();
  const colors = label.color ? labelChipColors(label.color.background, dark) : null;
  const name = label.name.split('/').pop();
  return (
    <span
      className="label-chip"
      style={colors ? { background: colors.bg, color: colors.fg } : undefined}
      title={label.name}
      data-removable={onRemove ? '' : undefined}
    >
      <span className="label-chip__text">{name}</span>
      {onRemove && (
        <button type="button" className="label-chip__remove" aria-label={label.id === 'INBOX' ? 'Archive (remove from Inbox)' : `Remove label ${label.name}`} onClick={onRemove}>
          <Icon name="close" size={18} />
        </button>
      )}
    </span>
  );
}
