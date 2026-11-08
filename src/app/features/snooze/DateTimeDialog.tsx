import { useEffect, useState } from 'react';
import { DatePickerDialog } from '../../ui/DatePicker';
import { TextField } from '../../ui/TextField';
import { fullTime } from '../../lib/presets';

interface Props {
  open: boolean;
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (t: number) => void;
  /** Such as how the time will be kept. */
  note?: string;
  /** The earliest time it takes (Gmail won't schedule a send a minute away). */
  leadMs?: number;
}

function toTimeValue(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

/** The M3 modal date picker with a time field, for snooze, schedule send and reminders. Every row's Snooze menu carries one, so closed it renders nothing; it stays mounted a beat after closing for its exit. */
export function DateTimeDialog(props: Props) {
  const [shown, setShown] = useState(props.open);
  useEffect(() => {
    if (props.open) return setShown(true);
    const t = window.setTimeout(() => setShown(false), 400);
    return () => window.clearTimeout(t);
  }, [props.open]);
  return props.open || shown ? <Picker {...props} /> : null;
}

function Picker({ open, title, confirmLabel, onClose, onConfirm, note, leadMs = 0 }: Props) {
  const [initial] = useState(tomorrowMorning);
  const [day, setDay] = useState<Date>(initial);
  const [time, setTime] = useState(toTimeValue(initial));

  const [h, m] = time.split(':').map(Number);
  const chosen = new Date(day);
  chosen.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  const valid = /^\d{1,2}:\d{2}/.test(time);
  const tooSoon = chosen.getTime() <= Date.now() + leadMs;
  const minutes = Math.round(leadMs / 60_000);

  return (
    // Keys typed in the dialog stay in it.
    <span onKeyDown={(e) => e.stopPropagation()} hidden>
      <DatePickerDialog
        open={open}
        value={initial}
        title={title}
        minDate={new Date()}
        confirmLabel={confirmLabel}
        confirmDisabled={!valid || tooSoon}
        headline={() => (valid ? fullTime(chosen.getTime()) : 'Pick a time')}
        onSelect={setDay}
        onClose={onClose}
        onConfirm={() => onConfirm(chosen.getTime())}
      >
        <div className="m3-datepicker__time">
          <TextField label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {valid && tooSoon && (
          <p className="m3-datepicker__error md-body-small">{minutes ? `Pick a time at least ${minutes} minutes from now.` : 'Pick a time in the future.'}</p>
        )}
        {note && <p className="m3-datepicker__note md-body-small">{note}</p>}
      </DatePickerDialog>
    </span>
  );
}
