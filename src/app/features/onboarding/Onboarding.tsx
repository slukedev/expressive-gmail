import { useRef, useState } from 'react';
import { useLabels } from '../../data/hooks';
import { useBackendKind } from '../../data/useBackendKind';
import { updateSettings, useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EmptyArt } from '../../ui/EmptyArt';
import type { IconName } from '../../ui/Icon';
import { keyLabel } from '../../ui/keys';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'mail', title: 'This is still your Gmail', text: 'You’re still signed in at mail.google.com, and anything you do here happens in your Gmail account.' },
  { icon: 'keyboard_command_key', title: 'Everything is a keystroke away', text: `Press ${keyLabel('Ctrl K')} for the command palette, or ? to see every shortcut.` },
  { icon: 'filter_alt', title: 'Make Gmail yours', text: 'Save any search as a split, pin threads to the top, set follow-up reminders and clean out newsletters in Subscriptions.' },
  { icon: 'swap_horiz', title: 'Classic Gmail is one click away', text: 'Switch to classic Gmail from your account menu or settings. Classic Gmail then keeps a button in its corner to bring you back.' },
];

// The demo mailbox skips the welcome; ?onboarding shows it there for review.
const PREVIEW_ONBOARDING = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('onboarding');

export function Onboarding() {
  const onboarded = useSettings((s) => s.onboarded);
  const loaded = useSettings(() => true);
  const kind = useBackendKind();
  const [step, setStep] = useState(0);
  // Opens once the mailbox has answered, over your mail rather than placeholders.
  const { isFetched: mailIn } = useLabels();
  const next = useRef<HTMLButtonElement>(null);
  const open = loaded && mailIn && !onboarded && (kind !== 'demo' || PREVIEW_ONBOARDING);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const finish = () => updateSettings({ onboarded: true });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && finish()}
      size="basic"
      className="onboarding"
      // Enter moves on; the first thing focused isn't Skip.
      initialFocus={next}
      actions={
        <>
          <span className="onboarding__dots" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className="onboarding__dot" />
            ))}
            <span className="onboarding__dot-active" style={{ transform: `translateX(${step * 24}px)` }} />
          </span>
          {!last && (
            <Button variant="text" onClick={finish}>
              Skip
            </Button>
          )}
          <Button ref={next} variant="filled" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? 'Get started' : 'Next'}
          </Button>
        </>
      }
    >
      <div className="onboarding__slide" key={step}>
        <EmptyArt icon={s.icon} size={112} />
        <h2 className="md-headline-small md-emphasized onboarding__title">{s.title}</h2>
        <p className="md-body-large onboarding__text">{s.text}</p>
      </div>
    </Dialog>
  );
}
