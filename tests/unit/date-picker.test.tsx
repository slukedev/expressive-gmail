import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;

const { DatePickerDialog } = await import('../../src/app/ui/DatePicker');

describe('the date picker with an earliest day', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 10, 16, 10), toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('keeps keyboard focus on a day that can be picked when the arrows run into the past', async () => {
    const today = new Date(2026, 10, 16);
    render(createElement(DatePickerDialog, { open: true, value: today, minDate: today, onClose: () => {}, onConfirm: () => {} }));
    await screen.findByRole('button', { name: 'Previous month' });
    // Today, the chosen day, holds the grid's one tab stop.
    const day = document.querySelector<HTMLButtonElement>('.m3-datepicker__day[tabindex="0"]')!;
    expect(day.textContent).toContain('16');
    day.focus();
    fireEvent.keyDown(day, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'PageUp' });
    const stop = document.querySelector<HTMLButtonElement>('.m3-datepicker__day[tabindex="0"]')!;
    expect(stop.disabled).toBe(false);
    expect(document.activeElement).toBe(stop);
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveProperty('disabled', true);
  });
});
