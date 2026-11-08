import { Popover } from '@base-ui/react/popover';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GeminiRequest, GeminiResult, ProofreadFix, RefineMode } from '../../data/gemini';
import type { ComposeDraft } from '../../state/ui';
import { Button, IconButton } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { Ripple } from '../../ui/Ripple';
import { snack } from '../../ui/Snackbar';
import { announce } from '../../ui/feedback';
import { Tooltip } from '../../ui/Tooltip';
import { IS_MAC as isMac } from '../../ui/keys';
import type { EditorHandle } from '../compose/Editor';
import { GeminiWords, textToHtml } from './GeminiText';
import { Spark } from './Spark';
import { geminiErrorText, isStopped, runGemini, useGeminiFeature, type GeminiRun } from './useGemini';
import './gemini.css';

const REFINES: { mode: RefineMode; label: string; icon: IconName; hint: string }[] = [
  { mode: 'polish', label: 'Polish', icon: 'auto_fix_high', hint: 'Fix the flow and the small mistakes' },
  { mode: 'formalize', label: 'Formalize', icon: 'work', hint: 'More professional' },
  { mode: 'elaborate', label: 'Elaborate', icon: 'notes', hint: 'Add detail' },
  { mode: 'shorten', label: 'Shorten', icon: 'short_text', hint: 'Keep only what matters' },
  { mode: 'rephrase', label: 'Rephrase', icon: 'autorenew', hint: 'Say it another way' },
];

type Step =
  | { kind: 'start' }
  | { kind: 'working'; label: string; text: string; request: GeminiRequest; replace: boolean }
  | { kind: 'result'; text: string; subject?: string; request: GeminiRequest; replace: boolean }
  | { kind: 'proofread'; fixes: ProofreadFix[]; source: string }
  | { kind: 'error'; message: string; request: GeminiRequest; replace: boolean; label: string };

/** Polish's shortcut in Gmail. */
const HELP_KEYS = isMac ? 'Alt+H' : 'Control+H';
const isHelpKey = (e: KeyboardEvent | React.KeyboardEvent) => e.code === 'KeyH' && !e.shiftKey && !e.metaKey && (isMac ? e.altKey && !e.ctrlKey : e.ctrlKey && !e.altKey);

/** Write from a prompt, rework what you wrote (Polish, Formalize, Elaborate, Shorten, Rephrase), Proofread, or Help me schedule. */
export function HelpMeWrite({ editor, draft, onSubject }: { editor: RefObject<EditorHandle | null>; draft: ComposeDraft; onSubject: (subject: string) => void }) {
  const write = useGeminiFeature('write');
  const refine = useGeminiFeature('refine');
  const proofread = useGeminiFeature('proofread');
  const schedule = useGeminiFeature('schedule');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'start' });
  const [prompt, setPrompt] = useState('');
  const [hasText, setHasText] = useState(false);
  const run = useRef<GeminiRun | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openFresh = () => {
    setStep({ kind: 'start' });
    setHasText(!!editor.current?.ownText().trim());
    setOpen(true);
  };
  const openRef = useRef(openFresh);
  openRef.current = openFresh;

  // Ctrl+H (Option+H on a Mac) opens it, as Polish does in Gmail.
  useEffect(() => {
    const root = editor.current?.root();
    const form = root?.closest('form');
    if (!form) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isHelpKey(e)) return;
      e.preventDefault();
      openRef.current();
    };
    form.addEventListener('keydown', onKey);
    return () => form.removeEventListener('keydown', onKey);
  }, [editor, write]);

  useEffect(() => () => run.current?.stop(), []);

  // Read out once written, not word by word.
  const finished = step.kind === 'result' ? step.text : step.kind === 'error' ? step.message : '';
  useEffect(() => {
    if (finished) announce(finished);
  }, [finished]);

  if (!write && !refine && !proofread) return null;

  const start = (request: GeminiRequest, label: string, replace: boolean) => {
    run.current?.stop();
    setStep({ kind: 'working', label, text: '', request, replace });
    const r = runGemini(request, (text) => setStep((s) => (s.kind === 'working' ? { ...s, text } : s)));
    run.current = r;
    r.result.then(
      (result: GeminiResult) => {
        if (run.current !== r) return;
        if (result.kind === 'draft') setStep({ kind: 'result', text: result.text, subject: offersSubject(request) ? result.subject : undefined, request, replace });
        else if (result.kind === 'proofread') setStep({ kind: 'proofread', fixes: result.fixes, source: (request as { text: string }).text });
      },
      (err) => {
        if (run.current !== r) return;
        if (isStopped(err)) setStep({ kind: 'start' });
        else setStep({ kind: 'error', message: geminiErrorText(err), request, replace, label });
      },
    );
  };

  const reply = draft.mode === 'reply' || draft.mode === 'reply-all' ? draft.threadId : undefined;
  const create = () => {
    const p = prompt.trim();
    if (!p && !reply) return;
    start(
      { kind: 'write', prompt: p || 'Draft a reply to the last message', ...(reply ? { threadId: reply } : {}), ...(draft.subject ? { subject: draft.subject } : {}), to: draft.to.map((a) => a.email) },
      'Writing',
      false,
    );
  };
  const rework = (mode: RefineMode, text?: string) => {
    const source = text ?? editor.current?.ownText() ?? '';
    if (!source.trim()) return;
    start({ kind: 'refine', mode, text: source, ...(reply ? { threadId: reply } : {}) }, REFINES.find((r) => r.mode === mode)!.label, text === undefined);
  };

  const close = () => {
    run.current?.stop();
    setOpen(false);
  };

  const insert = (text: string, subject: string | undefined, replace: boolean) => {
    const ed = editor.current;
    if (!ed) return;
    const had = ed.ownText().trim();
    if (replace || !had) {
      const previous = ed.replaceOwn(textToHtml(text));
      if (had) snack('Replaced your text', { action: { label: 'Undo', onClick: () => editor.current?.replaceOwn(previous, { restore: true }) } });
    } else {
      ed.focus('end');
      ed.insertHtml(textToHtml(`\n\n${text}`));
    }
    // A new message without a subject takes Gemini's; a reply or a typed subject stays.
    if (subject && !reply && !draft.subject) onSubject(subject);
    setPrompt('');
    setOpen(false);
  };

  const label = 'Help me write';
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => (o ? openFresh() : close())}
    >
      <Tooltip content={`${label} (${isMac ? '⌥H' : 'Ctrl+H'})`}>
        <Popover.Trigger
          ref={triggerRef}
          className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default hmw-trigger"
          aria-label={label}
          aria-keyshortcuts={HELP_KEYS}
          data-popup-open={open || undefined}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Spark size={22} />
          <Ripple />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner
          // Lined up with the message text and Send rather than the spark or the window's edge.
          anchor={() => composeActions(triggerRef.current) ?? triggerRef.current}
          side="top"
          align="start"
          sideOffset={8}
          alignOffset={() => inset(composeActions(triggerRef.current))}
          collisionPadding={12}
          className="m3-menu-positioner"
        >
          <Popover.Popup className="hmw" initialFocus={step.kind === 'start' && !hasText ? promptRef : undefined} aria-label={label}>
            <header className="hmw__head">
              <Spark size={20} busy={step.kind === 'working'} />
              <Popover.Title className="md-title-small hmw__title">{step.kind === 'proofread' ? 'Proofread' : label}</Popover.Title>
              <span className="hmw__spacer" />
              <Popover.Close render={<IconButton icon="close" size="xs" label="Close" />} />
            </header>

            {step.kind === 'start' && (
              <div className="hmw__start">
                {hasText && (refine || proofread) && (
                  <ul className="hmw__modes" aria-label="Rework what you wrote">
                    {refine &&
                      REFINES.map((r) => (
                        <li key={r.mode}>
                          <button type="button" className="hmw__mode" onClick={() => rework(r.mode)}>
                            <Icon name={r.icon} size={20} />
                            <span className="hmw__mode-text">
                              <span className="md-label-large">{r.label}</span>
                              <span className="md-body-small">{r.hint}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    {proofread && (
                      <li>
                        <button
                          type="button"
                          className="hmw__mode"
                          onClick={() => {
                            const text = editor.current?.ownText() ?? '';
                            start({ kind: 'proofread', text }, 'Proofreading', false);
                          }}
                        >
                          <Icon name="spellcheck" size={20} />
                          <span className="hmw__mode-text">
                            <span className="md-label-large">Proofread</span>
                            <span className="md-body-small">Spelling, grammar and clarity</span>
                          </span>
                        </button>
                      </li>
                    )}
                  </ul>
                )}
                {write && (
                  <form
                    className="hmw__prompt"
                    onSubmit={(e) => {
                      e.preventDefault();
                      // React carries a submit through the portal to the compose form, which would send the message.
                      e.stopPropagation();
                      create();
                    }}
                  >
                    <textarea
                      ref={promptRef}
                      className="hmw__input md-body-large"
                      rows={2}
                      value={prompt}
                      aria-label="What should Gemini write?"
                      placeholder={reply ? 'What should your reply say?' : 'What’s the email about? For example: ask Dana to move our 1:1 to Friday'}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          create();
                        }
                      }}
                    />
                    <div className="hmw__prompt-actions">
                      {schedule && (
                        <Button
                          variant="text"
                          size="xs"
                          icon="calendar_month"
                          onClick={() => start({ kind: 'schedule', ...(reply ? { threadId: reply } : {}) }, 'Finding times', false)}
                        >
                          Suggest meeting times
                        </Button>
                      )}
                      <span className="hmw__spacer" />
                      <Button type="submit" size="xs" disabled={!prompt.trim() && !reply}>
                        {prompt.trim() || !reply ? 'Create' : 'Draft a reply'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {(step.kind === 'working' || step.kind === 'result') && (
              <div className="hmw__result">
                <div className="hmw__preview md-body-large" aria-busy={step.kind === 'working' || undefined}>
                  {step.kind === 'working' && !step.text ? (
                    <div className="gemini-skeleton" role="status" aria-label={`${step.label}…`}>
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : (
                    <DraftPreview {...(step.kind === 'result' ? { subject: step.subject, body: step.text } : streamed(step.text, offersSubject(step.request)))} />
                  )}
                </div>
                <div className="hmw__actions">
                  {step.kind === 'working' ? (
                    <Button variant="text" size="xs" icon="stop" onClick={() => run.current?.stop()}>
                      Stop
                    </Button>
                  ) : (
                    <>
                      <Button size="xs" icon={step.replace ? 'swap_horiz' : 'add'} onClick={() => insert(step.text, step.subject, step.replace)}>
                        {step.replace ? 'Replace' : 'Insert'}
                      </Button>
                      <IconButton icon="refresh" size="xs" label="Recreate" onClick={() => start(step.request, 'Writing', step.replace)} />
                      {refine && (
                        <RefineMenu
                          onPick={(mode) => {
                            // Reworks Gemini's text, which then goes in the same way.
                            const keep = step.replace;
                            const before = step;
                            run.current?.stop();
                            setStep({ kind: 'working', label: 'Refining', text: '', request: step.request, replace: keep });
                            const r = runGemini({ kind: 'refine', mode, text: step.text }, (text) => setStep((s) => (s.kind === 'working' ? { ...s, text } : s)));
                            run.current = r;
                            r.result.then(
                              (res) => run.current === r && res.kind === 'draft' && setStep({ kind: 'result', text: res.text, subject: before.subject, request: { kind: 'refine', mode, text: step.text }, replace: keep }),
                              (err) => {
                                if (run.current !== r) return;
                                // Stopped: back to the text it was refining.
                                if (isStopped(err)) setStep(before);
                                else setStep({ kind: 'error', message: geminiErrorText(err), request: { kind: 'refine', mode, text: before.text }, replace: keep, label: 'Refining' });
                              },
                            );
                          }}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {step.kind === 'proofread' && <Proofread fixes={step.fixes} source={step.source} editor={editor} onDone={close} />}

            {step.kind === 'error' && (
              <div className="hmw__result">
                <p className="md-body-medium gemini-error__text">{step.message}</p>
                <div className="hmw__actions">
                  <Button size="xs" variant="tonal" icon="refresh" onClick={() => start(step.request, step.label, step.replace)}>
                    Try again
                  </Button>
                  <Button size="xs" variant="text" onClick={() => setStep({ kind: 'start' })}>
                    Back
                  </Button>
                </div>
              </div>
            )}
            {step.kind !== 'proofread' && <p className="md-body-small hmw__note">Gemini can make mistakes. Read it before you send.</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Its subject on a line of its own above the message. */
function DraftPreview({ subject, body }: { subject?: string; body: string }) {
  return (
    <>
      {subject && (
        <p className="hmw__subject">
          <span className="md-label-large hmw__subject-label">Subject</span>
          <span className="md-title-small hmw__subject-text">
            <GeminiWords text={subject} />
          </span>
        </p>
      )}
      <GeminiWords text={body} />
    </>
  );
}

/** Gemini writes "Subject:" before the session splits them. Anything above it ("Here's a draft:") isn't the draft. */
function splitDraft(text: string): { subject?: string; body: string } {
  const line = /^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?subject:(?:\*\*)?[ \t]*([^\n]*)(?:\n+|$)/im.exec(text);
  if (!line) return { body: text };
  return { subject: line[1]!.replace(/\*\*/g, '').trim(), body: text.slice(line.index + line[0].length).replace(/^\s*body:\s*/i, '') };
}

/** Refine never renames a message. */
function offersSubject(request: GeminiRequest) {
  return request.kind === 'write' && !request.subject && !request.threadId;
}

function streamed(text: string, withSubject: boolean) {
  const draft = splitDraft(text);
  return withSubject ? draft : { body: draft.body };
}

function composeActions(trigger: HTMLElement | null): HTMLElement | null {
  return trigger?.closest<HTMLElement>('.compose-actions') ?? null;
}

/** Where the message text and Send start. */
function inset(actions: HTMLElement | null): number {
  return actions ? parseFloat(getComputedStyle(actions).paddingInlineStart) || 0 : 0;
}

function RefineMenu({ onPick }: { onPick: (mode: RefineMode) => void }) {
  return (
    <div className="hmw__chips" role="group" aria-label="Refine">
      {REFINES.filter((r) => r.mode !== 'rephrase').map((r) => (
        <button key={r.mode} type="button" className="hmw__chip md-label-large" onClick={() => onPick(r.mode)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Proofread({ fixes, source, editor, onDone }: { fixes: ProofreadFix[]; source: string; editor: RefObject<EditorHandle | null>; onDone: () => void }) {
  const [left, setLeft] = useState(() => fixes.map((f) => ({ ...f, original: source.slice(f.start, f.end) })));
  // Accepting one shifts the offsets of everything after it.
  const accept = (fix: (typeof left)[number]) => {
    const ed = editor.current;
    if (!ed) return;
    if (ed.ownText().slice(fix.start, fix.end) !== fix.original) {
      snack('The message changed since Proofread read it. Run it again.');
      return;
    }
    if (!ed.replaceInOwn(fix.start, fix.end, fix.replacement)) {
      snack('That one spans formatting, so change it by hand.');
      return;
    }
    const delta = fix.replacement.length - (fix.end - fix.start);
    setLeft((l) => l.filter((f) => f !== fix).map((f) => (f.start >= fix.end ? { ...f, start: f.start + delta, end: f.end + delta } : f)));
  };
  const acceptAll = () => {
    const ed = editor.current;
    if (!ed) return;
    // From the end, so earlier offsets stay right.
    const text = ed.ownText();
    const missed: typeof left = [];
    for (const f of [...left].sort((a, b) => b.start - a.start)) {
      if (text.slice(f.start, f.end) !== f.original || !ed.replaceInOwn(f.start, f.end, f.replacement)) missed.push(f);
    }
    // Whatever couldn't change stays listed, so "All set" is only said when true.
    setLeft(missed.reverse());
    if (missed.length) snack(missed.length === 1 ? 'One suggestion couldn’t be applied. Change it by hand.' : `${missed.length} suggestions couldn’t be applied. Change them by hand.`);
  };
  if (!left.length) {
    return (
      <div className="hmw__result">
        <p className="md-body-large hmw__clean">
          <Icon name="check_circle" size={20} />
          {fixes.length ? 'All set. Your message is ready.' : 'Nothing to fix. It reads well.'}
        </p>
        <div className="hmw__actions">
          <Button size="xs" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="hmw__result">
      <ul className="hmw__fixes" aria-label="Suggestions">
        {left.map((f) => (
          <li key={`${f.start}-${f.end}-${f.replacement}`} className="hmw__fix">
            <span className="hmw__fix-text">
              <span className="md-body-medium">
                <del>{f.original.trim() ? f.original : '(extra space)'}</del>
                <Icon name="arrow_forward" size={16} />
                <ins>{f.replacement === ' ' ? '(one space)' : f.replacement}</ins>
              </span>
              <span className="md-body-small hmw__fix-kind">{f.kind}</span>
            </span>
            <Button size="xs" variant="tonal" onClick={() => accept(f)}>
              Accept
            </Button>
            <IconButton icon="close" size="xs" label="Ignore" onClick={() => setLeft((l) => l.filter((x) => x !== f))} />
          </li>
        ))}
      </ul>
      <div className="hmw__actions">
        <Button size="xs" icon="done_all" onClick={acceptAll}>
          Accept all
        </Button>
      </div>
    </div>
  );
}
