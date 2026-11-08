import { useRef, useState } from 'react';
import { geminiAvailable, geminiOn } from '../../data/gemini';
import { useLabels } from '../../data/hooks';
import { useBackendKind } from '../../data/useBackendKind';
import { updateSettings, useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { EmptyArt } from '../../ui/EmptyArt';
import type { IconName } from '../../ui/Icon';
import { keyLabel } from '../../ui/keys';
import { Switch } from '../../ui/Switch';
import { Spark } from '../gemini/Spark';
import { useGeminiStatus, useGeminiStatusSettled } from '../gemini/useGemini';

interface Step {
  icon: IconName;
  title: string;
  text: string;
  /** The Gemini step: its switch and its mark. */
  gemini?: boolean;
}

const STEPS: Step[] = [
  { icon: 'mail', title: 'This is still your Gmail', text: 'You’re still signed in at mail.google.com, and anything you do here happens in your Gmail account.' },
  { icon: 'keyboard_command_key', title: 'Everything is a keystroke away', text: `Press ${keyLabel('Ctrl K')} for the command palette, or ? to see every shortcut.` },
  { icon: 'filter_alt', title: 'Make Gmail yours', text: 'Save any search as a split, pin threads to the top, set follow-up reminders and clean out newsletters in Subscriptions.' },
  { icon: 'swap_horiz', title: 'Classic Gmail is one click away', text: 'Switch to classic Gmail from your account menu or settings. Classic Gmail then keeps a button in its corner to bring you back.' },
];

const GEMINI_STEP: Step = { icon: 'forum', title: 'Gemini in Gmail', text: 'Summaries, replies and Help me write.', gemini: true };

/**
 * Only accounts Gmail shows Gemini for get its step: a switch that can't turn on would be a dead end here, and skipping costs
 * nothing, since the untouched setting follows Gmail and Settings explains why it's off. Before Classic Gmail, which stays last.
 */
function onboardingSteps(withGemini: boolean): Step[] {
  return withGemini ? [...STEPS.slice(0, -1), GEMINI_STEP, STEPS.at(-1)!] : STEPS;
}

// The demo mailbox skips the welcome; ?onboarding shows it there for review.
const PREVIEW_ONBOARDING = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('onboarding');

export function Onboarding() {
  const onboarded = useSettings((s) => s.onboarded);
  const loaded = useSettings(() => true);
  const kind = useBackendKind();
  const [step, setStep] = useState(0);
  // Opens once the mailbox has answered, over your mail rather than placeholders.
  const { isFetched: mailIn } = useLabels();
  const status = useGeminiStatus();
  const statusIn = useGeminiStatusSettled();
  const choice = useSettings((s) => s.geminiChoice);
  const next = useRef<HTMLButtonElement>(null);
  const due = loaded && mailIn && statusIn && !onboarded && (kind !== 'demo' || PREVIEW_ONBOARDING);
  // Its steps are fixed once it opens: Gmail finishing its page mid-welcome doesn't move the dots under you.
  const [steps, setSteps] = useState<Step[]>();
  if (due && !steps) setSteps(onboardingSteps(geminiAvailable(status)));
  const open = due && !!steps;
  const list = steps ?? STEPS;
  const s = list[step]!;
  const last = step === list.length - 1;
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
            {list.map((_, i) => (
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
        <EmptyArt icon={s.icon} size={112} mark={s.gemini ? <Spark size={48} /> : undefined} />
        <h2 className="md-headline-small md-emphasized onboarding__title">{s.title}</h2>
        {s.gemini ? (
          <div className="md-body-large onboarding__text onboarding__text--choice">
            <p>{s.text}</p>
            {/* The same setting as Settings > Gemini. Untouched, it keeps following Gmail. */}
            <label className="onboarding__choice">
              <span>Use Gemini</span>
              <Switch checked={geminiOn(choice, status)} onCheckedChange={(on) => updateSettings({ geminiChoice: on })} />
            </label>
          </div>
        ) : (
          <p className="md-body-large onboarding__text">{s.text}</p>
        )}
      </div>
    </Dialog>
  );
}
