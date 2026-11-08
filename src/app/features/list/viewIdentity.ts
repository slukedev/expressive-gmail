import type { Label } from '../../data/types';
import type { View } from '../../router/routes';
import { labelChipColors } from '../../theme/color';
import type { IconName } from '../../ui/Icon';
import type { ShapeName } from '../../ui/ShapeIcon';

/** With Gmail's own hue for each. */
export const CATEGORY_TABS = [
  { value: 'primary', label: 'Primary', icon: 'inbox', hue: '#0b57d0' },
  { value: 'promotions', label: 'Promotions', icon: 'sell', hue: '#188038' },
  { value: 'social', label: 'Social', icon: 'group', hue: '#1a73e8' },
  { value: 'updates', label: 'Updates', icon: 'info', hue: '#e37400' },
  { value: 'forums', label: 'Forums', icon: 'forum', hue: '#9334e6' },
] as const;

export interface ViewIdentity {
  icon: IconName;
  shape: ShapeName;
  bg: string;
  fg: string;
}

const role = (container: string, on: string) => ({ bg: `var(--md-sys-color-${container})`, fg: `var(--md-sys-color-${on})` });

/** An icon in its own expressive shape and colour, shown by the title. */
export function viewIdentity(view: View, labels: Label[], dark: boolean): ViewIdentity {
  switch (view.kind) {
    case 'category': {
      const tab = CATEGORY_TABS.find((t) => t.value === view.category)!;
      const shape: ShapeName = { primary: 'Cookie9Sided', promotions: 'Sunny', social: 'Clover4Leaf', updates: 'Cookie7Sided', forums: 'Puffy' }[view.category] as ShapeName;
      if (view.category === 'primary') return { icon: 'inbox', shape, ...role('primary-container', 'on-primary-container') };
      return { icon: tab.icon as IconName, shape, ...labelChipColors(tab.hue, dark) };
    }
    case 'label': {
      const label = labels.find((l) => l.name === view.label);
      const colors = label?.color ? labelChipColors(label.color.background, dark) : role('secondary-container', 'on-secondary-container');
      return { icon: 'label', shape: 'Cookie4Sided', ...colors };
    }
    case 'search':
      return { icon: 'search', shape: 'Circle', ...role('secondary-container', 'on-secondary-container') };
    case 'split':
      return { icon: 'filter_alt', shape: 'Flower', ...role('tertiary-container', 'on-tertiary-container') };
    case 'subscriptions':
      return { icon: 'unsubscribe', shape: 'Cookie12Sided', ...role('secondary-container', 'on-secondary-container') };
    case 'attachments':
      return { icon: 'attachment', shape: 'Clover4Leaf', ...role('tertiary-container', 'on-tertiary-container') };
    case 'reminders':
      return { icon: 'alarm', shape: 'Cookie7Sided', ...role('primary-container', 'on-primary-container') };
    case 'purchases':
      return { icon: 'shopping_bag', shape: 'Sunny', ...role('tertiary-container', 'on-tertiary-container') };
    case 'storage':
      return { icon: 'cloud', shape: 'Puffy', ...role('secondary-container', 'on-secondary-container') };
    case 'ai-inbox':
      return { icon: 'checklist', shape: 'Cookie9Sided', ...role('tertiary-container', 'on-tertiary-container') };
    case 'folder':
      switch (view.folder) {
        case 'inbox':
          return { icon: 'inbox', shape: 'Cookie9Sided', ...role('primary-container', 'on-primary-container') };
        case 'starred':
          return { icon: 'star', shape: 'VerySunny', ...labelChipColors('#f4b400', dark) };
        case 'snoozed':
          return { icon: 'schedule', shape: 'Clover8Leaf', ...role('tertiary-container', 'on-tertiary-container') };
        case 'imp':
          return { icon: 'label_important', shape: 'Gem', ...labelChipColors('#e8b300', dark) };
        case 'sent':
          return { icon: 'send', shape: 'Slanted', ...role('secondary-container', 'on-secondary-container') };
        case 'scheduled':
          return { icon: 'schedule_send', shape: 'Cookie6Sided', ...role('tertiary-container', 'on-tertiary-container') };
        case 'drafts':
          return { icon: 'draft', shape: 'Pentagon', ...role('secondary-container', 'on-secondary-container') };
        case 'all':
          return { icon: 'stacks', shape: 'Bun', ...role('surface-container-highest', 'on-surface-variant') };
        case 'spam':
          return { icon: 'report', shape: 'Burst', ...role('error-container', 'on-error-container') };
        case 'trash':
          return { icon: 'delete', shape: 'Pill', ...role('surface-container-highest', 'on-surface-variant') };
      }
  }
  return { icon: 'inbox', shape: 'Cookie9Sided', ...role('primary-container', 'on-primary-container') };
}
