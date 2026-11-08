import { useState, type ReactElement } from 'react';
import { mail } from '../../data/actions';
import { describeTime, presetTime, snoozePresets } from '../../lib/presets';
import { Menu, MenuGroupLabel, MenuItem, MenuSeparator, Submenu } from '../../ui/Menu';
import { DateTimeDialog } from './DateTimeDialog';

export function SnoozeMenu({ ids, trigger, onDone }: { ids: string[]; trigger: ReactElement<Record<string, unknown>>; onDone?: () => void }) {
  const [picking, setPicking] = useState(false);
  const snooze = (t: number) => {
    void mail.snooze(ids, t, describeTime(t));
    onDone?.();
  };
  return (
    <>
      <Menu trigger={trigger} align="end">
        <MenuGroupLabel>Snooze until</MenuGroupLabel>
        <Presets onPick={snooze} />
        <MenuSeparator />
        <MenuItem icon="calendar_month" onClick={() => setPicking(true)}>
          Pick date and time
        </MenuItem>
      </Menu>
      <SnoozeDialog open={picking} onClose={() => setPicking(false)} onPick={snooze} />
    </>
  );
}

/** For another menu (the phone toolbar's overflow). The dialog lives with the caller, since the menu closes. */
export function SnoozeSubmenu({ ids, onCustom }: { ids: string[]; onCustom: () => void }) {
  return (
    <Submenu icon="schedule" label="Snooze">
      <MenuGroupLabel>Snooze until</MenuGroupLabel>
      <Presets onPick={(t) => void mail.snooze(ids, t, describeTime(t))} />
      <MenuSeparator />
      <MenuItem icon="calendar_month" onClick={onCustom}>
        Pick date and time
      </MenuItem>
    </Submenu>
  );
}

export function SnoozeDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: number) => void }) {
  return (
    <DateTimeDialog
      open={open}
      title="Pick date and time"
      confirmLabel="Snooze"
      onClose={onClose}
      onConfirm={(t) => {
        onClose();
        onPick(t);
      }}
    />
  );
}

/** Worked out when the menu opens, not on every list render. */
function Presets({ onPick }: { onPick: (t: number) => void }) {
  return snoozePresets().map((p) => (
    <MenuItem key={p.id} onClick={() => onPick(p.at)} trailing={<span className="menu-time">{presetTime(p.at)}</span>}>
      {p.label}
    </MenuItem>
  ));
}
