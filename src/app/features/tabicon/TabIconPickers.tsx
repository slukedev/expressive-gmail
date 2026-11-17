import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { CSSProperties } from 'react';
import { ACCOUNT_COLORS } from '../../data/accounts/store';
import { labelDotColor } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';
import { ACCOUNT_COLOR_NAMES } from '../accounts/AccountsSettings';
import { TAB_ICON_LOOKS, type TabIcon, type TabIconLook } from './choice';
import { renderTabIcon } from './render';
import { useGmailIconImage, useTabIconColors } from './useTabIcon';

/** Each choice is the icon itself, drawn in the chosen color. */
export function TabIconLookPicker({ icon, initial, onChange }: { icon: TabIcon; initial: string; onChange: (look: TabIconLook) => void }) {
  const colors = useTabIconColors(icon.color);
  const gmail = useGmailIconImage(true);
  return (
    <RadioGroup className="tab-icon-looks" aria-label="Icon" value={icon.look} onValueChange={(v) => onChange(v as TabIconLook)}>
      {TAB_ICON_LOOKS.map(({ look, label }) => {
        const src =
          look === 'gmail'
            ? gmail && renderTabIcon({ look: 'image', colors, unread: null }, gmail)
            : renderTabIcon({ look, colors, unread: null, initial });
        return (
          <Tooltip key={look} content={label}>
            <Radio.Root value={look} className="tab-icon-look" aria-label={label}>
              {src ? <img src={src} alt="" width={28} height={28} draggable={false} /> : <Icon name="tab" size={24} />}
            </Radio.Root>
          </Tooltip>
        );
      })}
    </RadioGroup>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TabIconColorPicker({ value, onChange }: { value: TabIcon['color']; onChange: (color: TabIcon['color']) => void }) {
  const dark = useResolvedDark();
  return (
    <RadioGroup className="tab-icon-colors" aria-label="Color" value={value} onValueChange={(v) => onChange(v as TabIcon['color'])}>
      <Tooltip content="Theme">
        <Radio.Root value="theme" className="tab-icon-color tab-icon-color--theme" aria-label="Theme">
          <Icon name="palette" size={18} />
        </Radio.Root>
      </Tooltip>
      {ACCOUNT_COLORS.map((c) => {
        const name = capital(ACCOUNT_COLOR_NAMES[c] ?? c);
        return (
          <Tooltip key={c} content={name}>
            <Radio.Root value={c} className="tab-icon-color" aria-label={name} style={{ '--swatch': labelDotColor(c, dark) } as CSSProperties} />
          </Tooltip>
        );
      })}
    </RadioGroup>
  );
}
