import { ShapeIcon } from '../../ui/ShapeIcon';
import { useUi } from '../../state/ui';
import { useSettings } from '../../state/settings';
import { Glance } from '../glance/Glance';

export function EmptyDetail() {
  const selected = useUi((s) => s.selected.size);
  const glance = useSettings((s) => s.glance);
  if (glance && !selected) {
    return (
      <section className="detail-pane detail-pane--glance" aria-label="At a glance">
        <Glance />
      </section>
    );
  }
  return (
    <section className="detail-pane detail-pane--empty" aria-label="Reading pane">
      <ShapeIcon
        className="empty-detail__mark"
        shape={selected ? 'Clover4Leaf' : 'Cookie12Sided'}
        icon={selected ? 'done_all' : 'mail'}
        size={120}
        iconSize={48}
        filled={false}
        bg={selected ? 'var(--md-sys-color-secondary-container)' : 'var(--md-sys-color-surface-container-high)'}
        fg={selected ? 'var(--md-sys-color-on-secondary-container)' : 'var(--md-sys-color-on-surface-variant)'}
      />
      <p className="md-title-medium empty__title">{selected ? `${selected} selected` : 'No conversation selected'}</p>
    </section>
  );
}
