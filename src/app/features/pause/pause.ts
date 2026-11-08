import { useEffect, useState } from 'react';
import { describeTime } from '../../lib/presets';
import { updateSettings, useSettings, useSettingsStore } from '../../state/settings';
import { snack } from '../../ui/Snackbar';

export interface PausePreset {
  id: string;
  label: string;
  /** Epoch ms, or null for "until I resume". */
  until: number | null;
}

export function pausePresets(now = new Date()): PausePreset[] {
  const inHour = now.getTime() + 60 * 60_000;
  const evening = new Date(now);
  evening.setHours(17, 0, 0, 0);
  const morning = new Date(now);
  morning.setDate(now.getDate() + 1);
  morning.setHours(8, 0, 0, 0);
  return [
    { id: '1h', label: 'For 1 hour', until: inHour },
    ...(evening.getTime() - now.getTime() > 90 * 60_000 ? [{ id: 'evening', label: 'Until 5 PM', until: evening.getTime() }] : []),
    { id: 'morning', label: 'Until tomorrow morning', until: morning.getTime() },
    { id: 'manual', label: 'Until I resume', until: null },
  ];
}

export function pauseInbox(until: number | null) {
  updateSettings({ inboxPause: { since: Date.now(), until } });
  snack(until ? `Inbox paused until ${describeTime(until)}` : 'Inbox paused. New mail waits until you resume.', {
    action: { label: 'Undo', onClick: () => updateSettings({ inboxPause: null }) },
  });
}

export function resumeInbox() {
  updateSettings({ inboxPause: null });
}

export function pauseActive(p: { since: number; until: number | null } | null, now = Date.now()): p is { since: number; until: number | null } {
  return !!p && (p.until === null || p.until > now);
}

/** Cleared automatically once its end time passes. */
export function useInboxPause() {
  const pause = useSettings((s) => s.inboxPause);
  const [, tick] = useState(0);
  useEffect(() => {
    const until = pause?.until;
    if (!until) return;
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      const ms = until - Date.now();
      if (ms <= 0) {
        if (useSettingsStore.getState().settings.inboxPause?.until === until) updateSettings({ inboxPause: null });
        tick((n) => n + 1);
        return;
      }
      // Timers cap out near 24.8 days and stall while the computer sleeps; re-arm in steps.
      timer = window.setTimeout(check, Math.min(ms, 60 * 60_000));
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pause?.until]);
  return pauseActive(pause) ? pause : null;
}
