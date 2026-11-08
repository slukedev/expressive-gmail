import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { weekStartDay } from '../lib/format';
import { Button, IconButton, cx } from './Button';
import { Icon } from './Icon';

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function addMonths(d: Date, n: number) {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
}

/** Read and written as a local date. */
function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** M3 modal date picker (DatePickerModalTokens). Arrow keys move by day and week, Page Up and Page Down by month. */
interface PickerExtras {
  /** Days before this can't be picked. */
  minDate?: Date;
  /** A time field, for date and time pickers. */
  children?: ReactNode;
  /** Replaces the chosen day as the headline. */
  headline?: (selected: Date | null) => string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  /** For callers that show more than the day. */
  onSelect?: (date: Date) => void;
}

export function DatePickerDialog({
  open,
  value,
  title = 'Select date',
  onClose,
  onConfirm,
  ...extras
}: {
  open: boolean;
  value: Date | null;
  title?: string;
  onClose: () => void;
  onConfirm: (date: Date | null) => void;
} & PickerExtras) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="m3-scrim" forceRender />
        <BaseDialog.Popup
          ref={popup}
          className="m3-dialog m3-datepicker"
          aria-label={title}
          // Focus starts on the chosen day (or today), ready for the arrow keys.
          initialFocus={() => popup.current?.querySelector<HTMLElement>('.m3-datepicker__day[tabindex="0"]') ?? true}
        >
          <Picker value={value} title={title} onClose={onClose} onConfirm={onConfirm} {...extras} />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

function Picker({
  value,
  title,
  onClose,
  onConfirm,
  minDate,
  children,
  headline: headlineFor,
  confirmLabel = 'OK',
  confirmDisabled,
  onSelect,
}: { value: Date | null; title: string; onClose: () => void; onConfirm: (date: Date | null) => void } & PickerExtras) {
  const today = startOfDay(new Date());
  const [selected, setSelected] = useState<Date | null>(value);
  const [focus, setFocus] = useState<Date>(value ?? today);
  const [years, setYears] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const yearList = useRef<HTMLDivElement>(null);

  const month = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const start = weekStartDay();
  const lead = (month.getDay() - start + 7) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 7 + ((start + i) % 7));
    return { short: d.toLocaleDateString(undefined, { weekday: 'narrow' }), long: d.toLocaleDateString(undefined, { weekday: 'long' }) };
  });

  // Keyboard moves land focus on the new day, even across months.
  useLayoutEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focus]);
  useEffect(() => {
    if (years) yearList.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [years]);

  const onGridKey = (e: KeyboardEvent) => {
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -((focus.getDay() - start + 7) % 7)),
      End: () => addDays(focus, 6 - ((focus.getDay() - start + 7) % 7)),
    };
    const next = step[e.key];
    if (!next) return;
    e.preventDefault();
    moved.current = true;
    setFocus(next());
  };

  const min = minDate ? startOfDay(minDate) : undefined;
  const headline = headlineFor
    ? headlineFor(selected)
    : selected
    ? selected.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(selected.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
    : 'No date';
  const thisYear = today.getFullYear();
  const yearRange = Array.from({ length: thisYear + 10 - 1990 + 1 }, (_, i) => 1990 + i);

  return (
    <>
      <header className="m3-datepicker__header">
        <BaseDialog.Title className="md-label-large m3-datepicker__title">{title}</BaseDialog.Title>
        <p className="m3-datepicker__headline" aria-live="polite">
          {headline}
        </p>
      </header>
      <div className="m3-datepicker__nav">
        <button
          type="button"
          className="m3-datepicker__month"
          aria-label={years ? 'Back to days' : `${month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}, choose year`}
          onClick={() => setYears((y) => !y)}
        >
          <span className="md-label-large">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          <Icon name="arrow_drop_down" size={20} className="m3-datepicker__caret" data-open={years || undefined} />
        </button>
        {!years && (
          <span className="m3-datepicker__arrows">
            <IconButton icon="chevron_left" label="Previous month" onClick={() => setFocus(addMonths(focus, -1))} />
            <IconButton icon="chevron_right" label="Next month" onClick={() => setFocus(addMonths(focus, 1))} />
          </span>
        )}
      </div>
      {years ? (
        <div className="m3-datepicker__years" role="listbox" aria-label="Year" ref={yearList}>
          {yearRange.map((y) => (
            <button
              key={y}
              type="button"
              role="option"
              aria-selected={y === focus.getFullYear()}
              className={cx('m3-datepicker__year', y === thisYear && 'm3-datepicker__year--current')}
              onClick={() => {
                setFocus(new Date(y, focus.getMonth(), Math.min(focus.getDate(), new Date(y, focus.getMonth() + 1, 0).getDate())));
                setYears(false);
              }}
            >
              {y}
            </button>
          ))}
        </div>
      ) : (
        <div className="m3-datepicker__grid" role="grid" aria-label={month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} ref={grid} onKeyDown={onGridKey}>
          <div className="m3-datepicker__row" role="row">
            {weekdays.map((w) => (
              <span key={w.long} role="columnheader" aria-label={w.long} className="m3-datepicker__weekday">
                {w.short}
              </span>
            ))}
          </div>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, r) => (
            <div key={r} className="m3-datepicker__row" role="row">
              {cells.slice(r * 7, r * 7 + 7).map((d, i) =>
                d ? (
                  <span key={i} role="gridcell" aria-selected={sameDay(d, selected)}>
                    <button
                      type="button"
                      tabIndex={sameDay(d, focus) ? 0 : -1}
                      className={cx('m3-datepicker__day', sameDay(d, today) && 'm3-datepicker__day--today', sameDay(d, selected) && 'm3-datepicker__day--selected')}
                      aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      aria-current={sameDay(d, today) ? 'date' : undefined}
                      disabled={!!min && d < min}
                      onClick={() => {
                        setSelected(d);
                        setFocus(d);
                        onSelect?.(d);
                      }}
                    >
                      {d.getDate()}
                    </button>
                  </span>
                ) : (
                  <span key={i} role="gridcell" />
                ),
              )}
            </div>
          ))}
        </div>
      )}
      {children}
      <footer className="m3-datepicker__actions">
        {value && !onSelect && (
          <Button variant="text" className="m3-datepicker__clear" onClick={() => onConfirm(null)}>
            Clear
          </Button>
        )}
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="text" disabled={!selected || confirmDisabled} onClick={() => onConfirm(selected)}>
          {confirmLabel}
        </Button>
      </footer>
    </>
  );
}

/** Opens the modal picker from the field or its calendar button. Delete clears it. */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = parseIsoDate(value);
  const text = date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const id = useId();
  return (
    <div className="m3-field m3-field--outlined m3-datefield">
      <div className="m3-field__container">
        <input
          id={id}
          className="m3-field__input"
          readOnly
          placeholder=" "
          value={text}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            } else if ((e.key === 'Backspace' || e.key === 'Delete') && value) {
              e.preventDefault();
              onChange('');
            }
          }}
        />
        <label htmlFor={id} className="m3-field__label">
          {label}
        </label>
        <span className="m3-field__trailing">
          <IconButton icon="calendar_today" label={date ? `Choose date, ${text}` : 'Choose date'} size="s" onClick={() => setOpen(true)} />
        </span>
        <span className="m3-field__outline" aria-hidden="true" />
      </div>
      {/* Keys pressed in the picker stay in it. */}
      <span onKeyDown={(e) => e.stopPropagation()} hidden>
        <DatePickerDialog
          open={open}
          value={date}
          onClose={() => setOpen(false)}
          onConfirm={(d) => {
            setOpen(false);
            onChange(d ? toIsoDate(d) : '');
          }}
        />
      </span>
    </div>
  );
}

