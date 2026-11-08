import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Ripple } from './Ripple';

export interface TabItem {
  value: string;
  label: string;
  icon?: IconName;
  badge?: ReactNode;
  /** Gmail's "Sender, Sender" preview. */
  supporting?: ReactNode;
}

/** M3 primary tabs: a 3px indicator as wide as the active tab's content (PrimaryIndicator, matchContentSize), sliding on the spatial spring. */
export function Tabs({
  items,
  value,
  onValueChange,
  label,
  className,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (v: string) => void;
  label: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const content = list.querySelector<HTMLElement>('.m3-tab[data-active] .m3-tab__content');
      if (!content) return setBar(null);
      const l = list.getBoundingClientRect();
      const c = content.getBoundingClientRect();
      const width = Math.max(24, c.width);
      setBar({ left: c.left - l.left + list.scrollLeft + (c.width - width) / 2, width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value, items]);

  return (
    <BaseTabs.Root value={value} onValueChange={(v) => onValueChange(v as string)} className={className}>
      <BaseTabs.List className="m3-tabs" aria-label={label} ref={listRef}>
        {items.map((item) => (
          <BaseTabs.Tab key={item.value} value={item.value} className="m3-tab">
            <span className="m3-tab__content">
              {item.icon && <Icon name={item.icon} size={20} filled={item.value === value} className="m3-tab__icon" />}
              <span className="m3-tab__text">
                <span className="m3-tab__label">{item.label}</span>
                {item.supporting && <span className="m3-tab__supporting">{item.supporting}</span>}
              </span>
              {item.badge}
            </span>
            <Ripple />
          </BaseTabs.Tab>
        ))}
        {bar && <span className="m3-tabs__indicator" style={{ transform: `translateX(${bar.left}px)`, width: bar.width }} aria-hidden="true" />}
      </BaseTabs.List>
    </BaseTabs.Root>
  );
}
