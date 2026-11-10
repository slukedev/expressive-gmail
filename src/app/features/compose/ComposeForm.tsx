import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAccount } from '../../data/hooks';
import { splitId } from '../../data/accounts/ids';
import type { Address } from '../../data/types';
import { AccountChip, useAccountViews } from '../accounts/AccountBits';
import { useBackendKind, useCapabilities } from '../../data/useBackendKind';
import { EMAIL_RE, fileSize, stripHtml } from '../../lib/format';
import { SCHEDULE_LEAD_MS, fullTime, schedulePresets, scheduleTime } from '../../lib/presets';
import { useSettings, type Template } from '../../state/settings';
import { useUi, type ComposeDraft } from '../../state/ui';
import { Button, IconButton, cx } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Icon, type IconName } from '../../ui/Icon';
import { MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, Submenu } from '../../ui/Menu';
import { snack } from '../../ui/Snackbar';
import { Select } from '../../ui/Select';
import { ShapeIcon } from '../../ui/ShapeIcon';
import { Tooltip } from '../../ui/Tooltip';
import { keyLabel } from '../../ui/keys';
import { fileIcon } from '../attachments/fileIcon';
import { DateTimeDialog } from '../snooze/DateTimeDialog';
import { attachmentMention } from '../attachreminder/mentions';
import { AttachmentReminder } from '../attachreminder/AttachmentReminder';
import { Editor, type EditorHandle } from './Editor';
import { EmojiPicker } from './EmojiPicker';
import { FormatToolbar, ariaKeys } from './FormatToolbar';
import { LinkDialog } from './LinkDialog';
import { RecipientField } from './RecipientField';
import { SignatureMenu, currentSignatureChoice, signatureChoices } from './SignatureMenu';
import { cancelDraftSave, discardDraft, scheduleDraftSave, sendDraft } from './send';
import { signatureIn } from './signatureDom';
import { defaultSignature, importSignatures, useComposeData, type SignatureUse } from './signatures';
import { saveReporter } from './status';
import { TemplatePicker } from './TemplatePicker';
import { HelpMeWrite } from '../gemini/HelpMeWrite';
import { ComposeRail } from './ComposeRail';
import { isComposing } from '../../lib/ime';
import './compose.css';

const MAX_ATTACH = 25 * 1024 * 1024;
/** Under this width the less used tools move into More. */
const NARROW = 500;
/** Discard moves into More too, as on Gmail for phones. */
const TIGHT = 420;
/** Insert link too. */
const TINY = 360;
const SCHEDULED_EXTRA = 120;
/** The expanded composer gets its side rail from here. */
const WIDE = 880;

interface SendOptions {
  sendAt?: number;
  remindInDays?: number;
  /** Already asked about a missing attachment for this send. */
  attachmentChecked?: boolean;
}

interface Pending {
  id: string;
  filename: string;
  size: number;
  loaded: number;
}

function readFile(file: File, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onprogress = (e) => onProgress(e.loaded);
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Outside the signature and quoted mail. */
function hasOwnWords(html: string) {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('.gmail_signature, .gmail_quote, blockquote').forEach((n) => n.remove());
  return !!t.content.textContent?.trim();
}

function useWidth(ref: React.RefObject<HTMLElement | null>, guess = 0) {
  const [width, setWidth] = useState(guess);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const who = (a: Address) => a.name || a.email;
const noneTo = (d: ComposeDraft) => !d.to.length && !d.cc.length && !d.bcc.length;

export function ComposeForm({ draft, variant, onEscape, compact }: { draft: ComposeDraft; variant: 'window' | 'inline' | 'full'; onEscape?: () => void; compact?: boolean }) {
  const update = (patch: Partial<ComposeDraft>) => useUi.getState().updateCompose(draft.key, patch);
  const { data: account } = useAccount();
  const accountViews = useAccountViews();
  const caps = useCapabilities();
  const kind = useBackendKind();
  const editor = useRef<EditorHandle>(null);
  const [ccOpen, setShowCc] = useState(false);
  const [bccOpen, setShowBcc] = useState(false);
  const showCc = ccOpen || draft.cc.length > 0;
  const showBcc = bccOpen || draft.bcc.length > 0;
  // An inline reply opens straight into writing; its recipients fold into one line.
  const [expanded, setFieldsOpen] = useState(variant !== 'inline');
  // In a merged inbox the sending account always shows.
  const fieldsOpen = expanded || noneTo(draft) || !!account?.members;
  const [formatting, setFormatting] = useState(false);
  const [formatUsed, setFormatUsed] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sendMenu, setSendMenu] = useState(false);
  const [link, setLink] = useState<{ text: string; href: string; editing: boolean } | null>(null);
  const [emoji, setEmoji] = useState(false);
  const [slash, setSlash] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [moreSig, setMoreSig] = useState('none');
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // Full screen starts from the page's known width, so its first frame is already the wide layout.
  const width = useWidth(formRef, variant === 'full' && !compact ? window.innerWidth - 32 : 0);
  // A scheduled time makes Send wider, so tools move into More sooner.
  const narrow = width > 0 && width < (draft.sendAt ? NARROW + SCHEDULED_EXTRA : NARROW);
  const tight = width > 0 && width < (draft.sendAt ? TIGHT + SCHEDULED_EXTRA : TIGHT);
  const tiny = width > 0 && width < (draft.sendAt ? TINY + SCHEDULED_EXTRA : TINY);
  // On a phone full screen stays the plain form.
  const wide = variant === 'full' && !compact && width >= WIDE;
  const templates = useSettings((s) => s.templates);
  const attachmentReminder = useSettings((s) => s.attachmentReminder);
  const signatures = useComposeData((s) => s.signatures);
  const [forgotten, setForgotten] = useState<{ phrase: string; opts: SendOptions } | null>(null);
  // After attaching from the reminder, Send takes focus so one more Enter finishes.
  const focusSendAfterAttach = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const report = useRef(saveReporter(draft.key)).current;

  useEffect(() => importSignatures(account), [account]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scheduleDraftSave(latest.current, report);
  }, [draft.to, draft.cc, draft.bcc, draft.subject, draft.html, draft.attachments, report]);

  useEffect(() => {
    // Picking a draft back up puts the caret after what you wrote; a fresh one starts at the top.
    if (variant === 'inline' || draft.to.length) window.setTimeout(() => editor.current?.focus(hasOwnWords(draft.html) ? 'end' : 'start'), 50);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching between reply and forward takes the opened quote back out; the new mode brings its own.
  const lastMode = useRef(draft.mode);
  useEffect(() => {
    if (lastMode.current === draft.mode) return;
    lastMode.current = draft.mode;
    editor.current?.removeQuotes();
  }, [draft.mode]);

  const invalid = [...draft.to, ...draft.cc, ...draft.bcc].filter((a) => !EMAIL_RE.test(a.email));
  const noRecipients = !draft.to.length && !draft.cc.length && !draft.bcc.length;

  useEffect(() => {
    if (!focusSendAfterAttach.current || !draft.attachments.length) return;
    focusSendAfterAttach.current = false;
    formRef.current?.querySelector<HTMLButtonElement>('.split-button__main')?.focus();
  }, [draft.attachments.length]);

  const trySend = (opts: SendOptions = {}) => {
    if (pending.length) {
      snack('Wait for the attachments to finish loading, then send.');
      return;
    }
    if (noRecipients) {
      snack('Add at least one recipient.');
      setFieldsOpen(true);
      return;
    }
    if (invalid.length) {
      snack(`The address "${invalid[0].email}" isn't valid. Check it and try again.`);
      setFieldsOpen(true);
      return;
    }
    if (!draft.subject.trim() && !hasOwnWords(draft.html) && !confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    if (attachmentReminder && !opts.attachmentChecked && !latest.current.attachments.length) {
      const phrase = attachmentMention({ subject: draft.subject, html: latest.current.html, checkSubject: draft.mode === 'new' });
      if (phrase) {
        setForgotten({ phrase, opts });
        return;
      }
    }
    // A picked schedule time goes with Send; Send with reminder goes now.
    const sendAt = opts.sendAt ?? (opts.remindInDays ? undefined : draft.sendAt);
    if (sendAt && sendAt < Date.now() + SCHEDULE_LEAD_MS) {
      snack(sendAt <= Date.now() ? 'That time has passed. Pick a new one.' : 'That time is too soon for Gmail. Pick a new one.');
      update({ sendAt: undefined });
      return;
    }
    cancelDraftSave(draft.key);
    sendDraft(latest.current, { ...opts, sendAt });
  };
  /** Only sets it: the Send button shows it, and pressing Send schedules. */
  const pickSendAt = (at: number) => {
    update({ sendAt: at });
    setSendMenu(false);
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const total = latest.current.attachments.reduce((n, a) => n + a.size, 0) + pending.reduce((n, p) => n + p.size, 0) + files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_ATTACH) {
      snack('Attachments can be up to 25 MB in total. Share bigger files with a link.');
      return;
    }
    const jobs = files.map((f) => ({ file: f, item: { id: crypto.randomUUID(), filename: f.name, size: f.size, loaded: 0 } }));
    setPending((p) => [...p, ...jobs.map((j) => j.item)]);
    let failed = 0;
    await Promise.all(
      jobs.map(async ({ file, item }) => {
        try {
          const data = await readFile(file, (loaded) => setPending((p) => p.map((x) => (x.id === item.id ? { ...x, loaded } : x))));
          const att = { id: item.id, filename: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, data };
          useUi.getState().updateCompose(draft.key, { attachments: [...(useUi.getState().composes.find((c) => c.key === draft.key)?.attachments ?? []), att] });
        } catch {
          failed++;
        } finally {
          setPending((p) => p.filter((x) => x.id !== item.id));
        }
      }),
    );
    if (failed) snack(failed === 1 ? "Couldn't read one file. Try attaching it again." : `Couldn't read ${failed} files. Try attaching them again.`);
  };

  // Files the installed app was opened with or shared: attached the same way as picked ones.
  useEffect(() => {
    const files = draft.incomingFiles;
    if (!files?.length) return;
    useUi.getState().updateCompose(draft.key, { incomingFiles: undefined });
    void addFiles(files);
  }, [draft.incomingFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // A reply in a merged inbox can only go out from the account that has the thread.
  const owner = draft.threadId || draft.draftId ? account?.members?.find((m) => m.key === splitId(draft.threadId ?? draft.draftId!).key) : undefined;
  const fromOptions = owner ? (owner.sendAs?.length ? owner.sendAs : [{ name: owner.name, email: owner.email }]) : (account?.sendAs ?? []);
  const fromMany = fromOptions.length > 1;
  // In a merged inbox the sending account is never implied.
  const fromFixed = !fromMany && !!account?.members;
  const sendingEmail = (draft.from?.email ?? owner?.email ?? account?.email ?? '').toLowerCase();
  const sendingAccount = accountViews.find((a) => a.email.toLowerCase() === sendingEmail || (account?.members?.find((m) => m.key === a.key)?.sendAs ?? []).some((x) => x.email.toLowerCase() === sendingEmail));
  const slashMatches = slash === null ? [] : templates.filter((t) => t.shortcut.toLowerCase().startsWith(slash.toLowerCase()) || t.name.toLowerCase().includes(slash.toLowerCase()));
  const use: SignatureUse = draft.mode === 'new' ? 'new' : 'reply';

  /** Brings its own default signature, unless you picked a different one for this message. */
  const changeFrom = (email: string) => {
    const next = fromOptions.find((a) => a.email === email);
    const root = editor.current?.root();
    const data = useComposeData.getState();
    if (root && data.loaded) {
      const was = defaultSignature(data, sendingEmail, use)?.id ?? null;
      if (signatureIn(root, data.signatures) === was) editor.current?.setSignature(defaultSignature(data, email, use)?.html ?? null);
    }
    update({ from: next });
  };

  const openLink = () => {
    const at = editor.current?.linkAtSelection();
    setLink(at ? { ...at, editing: true } : { text: editor.current?.getSelectionText() ?? '', href: '', editing: false });
  };

  const focusField = (label: string) => {
    window.setTimeout(() => formRef.current?.querySelector<HTMLInputElement>(`input[role="combobox"][aria-label="${label}"]`)?.focus(), 0);
  };

  const onKeyDownCapture = (e: KeyboardEvent<HTMLFormElement>) => {
    // Keys pressed in a dialog or menu opened from here travel up React's tree too.
    if (!e.currentTarget.contains(e.target as Node) || isComposing(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) setSendMenu(true);
      else trySend();
    } else if (mod && e.shiftKey && key === 'c') {
      e.preventDefault();
      e.stopPropagation();
      setFieldsOpen(true);
      setShowCc(true);
      focusField('Cc');
    } else if (mod && e.shiftKey && key === 'b') {
      e.preventDefault();
      e.stopPropagation();
      setFieldsOpen(true);
      setShowBcc(true);
      focusField('Bcc');
    } else if (e.key === 'Escape' && onEscape) {
      // An open suggestion list or template picker takes Escape first.
      if (e.currentTarget.querySelector('input[role="combobox"][aria-expanded="true"], .template-picker')) return;
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
  };

  const showRecipients = () => {
    setFieldsOpen(true);
    window.setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus(), 0);
  };

  const quoteToggle = draft.quoteHtml && (
    <div className="compose-quote">
      {draft.mode === 'forward' ? (
        <button
          type="button"
          className="compose-quote__forward"
          onClick={() => {
            editor.current?.appendQuote(draft.quoteHtml!);
            update({ quoteHtml: undefined });
          }}
        >
          <Icon name="forward" size={20} />
          <span className="md-label-large">Forwarded message</span>
          <span className="md-body-small compose-quote__hint">Goes below your message. Click to edit it.</span>
        </button>
      ) : (
        <Tooltip content="Show trimmed content">
          <button
            type="button"
            className="msg__trimmed compose__quote-toggle"
            aria-label="Show quoted text"
            onClick={() => {
              editor.current?.appendQuote(draft.quoteHtml!);
              update({ quoteHtml: undefined });
            }}
          >
            <span aria-hidden="true">•••</span>
          </button>
        </Tooltip>
      )}
    </div>
  );

  const slashId = `${draft.key}-templates`;
  const sendKeys = ariaKeys('⌘Enter');

  return (
    <form
      ref={formRef}
      className={cx('compose-form', `compose-form--${variant}`, drag !== null && 'compose-form--drop', narrow && 'compose-form--narrow', tight && 'compose-form--tight', wide && 'compose-form--wide')}
      onSubmit={(e) => {
        e.preventDefault();
        trySend();
      }}
      onKeyDownCapture={onKeyDownCapture}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDrag(e.dataTransfer.items.length);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (drag === null) setDrag(e.dataTransfer.items.length);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag(null)}
      onDrop={(e) => {
        setDrag(null);
        if (e.defaultPrevented || !e.dataTransfer.files.length) return;
        e.preventDefault();
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="compose-sheet">
      {fieldsOpen ? (
        <div className="compose-fields">
          {/* On the expanded page the subject is the title, first in reading and Tab order. */}
          {wide && <SubjectTitle value={draft.subject} onChange={(subject) => update({ subject })} onDone={() => editor.current?.focus()} />}
          <div className="compose-people">
          {fromMany && (
            <div className="compose-from">
              <span className="recipients__label">From</span>
              <Select
                label="From"
                className="compose-from__select"
                value={draft.from?.email ?? owner?.email ?? account?.email ?? ''}
                onChange={changeFrom}
                options={fromOptions.map((a) => [a.email, a.name ? `${a.name} <${a.email}>` : a.email] as [string, string])}
              />
            </div>
          )}
          {fromFixed && (
            <div className="compose-from compose-from--fixed">
              <span className="recipients__label">From</span>
              {sendingAccount && <AccountChip account={sendingAccount} />}
              <span className="compose-from__address">{fromOptions[0] ? (fromOptions[0].name ? `${fromOptions[0].name} <${fromOptions[0].email}>` : fromOptions[0].email) : sendingEmail}</span>
            </div>
          )}
          <RecipientField
            label="To"
            value={draft.to}
            onChange={(to) => update({ to })}
            autoFocus={variant !== 'inline' && !draft.to.length}
            trailing={
              <span className="recipients__toggles">
                {!showCc && (
                  <Tooltip content={`Add Cc recipients (${keyLabel('⌘⇧C')})`}>
                    <button type="button" className="text-toggle" aria-keyshortcuts={ariaKeys('⌘⇧C')} onClick={() => setShowCc(true)}>
                      Cc
                    </button>
                  </Tooltip>
                )}
                {!showBcc && (
                  <Tooltip content={`Add Bcc recipients (${keyLabel('⌘⇧B')})`}>
                    <button type="button" className="text-toggle" aria-keyshortcuts={ariaKeys('⌘⇧B')} onClick={() => setShowBcc(true)}>
                      Bcc
                    </button>
                  </Tooltip>
                )}
              </span>
            }
          />
          {showCc && <RecipientField label="Cc" value={draft.cc} onChange={(cc) => update({ cc })} autoFocus={!draft.cc.length} />}
          {showBcc && <RecipientField label="Bcc" value={draft.bcc} onChange={(bcc) => update({ bcc })} autoFocus={!draft.bcc.length} />}
          </div>
          {!wide && variant !== 'inline' && (
            <input
              className="compose-subject"
              value={draft.subject}
              onChange={(e) => update({ subject: e.target.value })}
              placeholder="Subject"
              aria-label="Subject"
              onKeyDown={(e) => e.stopPropagation()}
            />
          )}
        </div>
      ) : (
        <button type="button" className="compose-summary" onClick={showRecipients} aria-label={`Recipients: ${[...draft.to, ...draft.cc, ...draft.bcc].map(who).join(', ')}. Edit recipients`}>
          <span className="recipients__label">To</span>
          <span className="compose-summary__names">
            {draft.to.map(who).join(', ')}
            {draft.cc.length > 0 && <span className="compose-summary__cc">, cc {draft.cc.map(who).join(', ')}</span>}
            {draft.bcc.length > 0 && <span className="compose-summary__cc">, bcc {draft.bcc.map(who).join(', ')}</span>}
          </span>
          <Icon name="edit" size={18} className="compose-summary__edit" />
        </button>
      )}
      {wide && (
        <div className="compose-format-dock">
          <FormatToolbar editor={editor} floating={false} />
        </div>
      )}

      <div
        className="compose-body"
        data-toolbar={formatting || undefined}
        onMouseDown={(e) => {
          // The empty space around the text writes where you left off, never into the signature.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          editor.current?.focus('end');
        }}
      >
        <Editor
          ref={editor}
          initialHtml={draft.html}
          label="Message body"
          placeholder={variant === 'inline' ? 'Write your reply' : ''}
          onChange={(html) => update({ html })}
          onFiles={(files) => void addFiles(files)}
          onLink={openLink}
          onSlash={templates.length ? setSlash : undefined}
          minHeight={variant === 'inline' ? 120 : undefined}
          activeDescendant={slashMatches.length ? `${slashId}-active` : undefined}
          controls={slashMatches.length ? slashId : undefined}
        />
        {!wide && quoteToggle}
        {slashMatches.length > 0 && (
          <TemplatePicker
            id={slashId}
            templates={slashMatches}
            onPick={(t) => {
              editor.current?.replaceSlash(t.html);
              if (t.subject && !draft.subject) update({ subject: t.subject });
              setSlash(null);
            }}
            onClose={() => setSlash(null)}
          />
        )}
      </div>

      </div>

      {wide && (
        <ComposeRail
          draft={draft}
          pending={pending}
          onAddFiles={() => fileInput.current?.click()}
          onRemove={(a) => update({ attachments: draft.attachments.filter((x) => x.id !== a.id) })}
          onExpandQuote={() => {
            editor.current?.appendQuote(draft.quoteHtml!);
            update({ quoteHtml: undefined });
          }}
        />
      )}

      <div className="compose-footer">
        {/* Stays mounted after the first open so it can fold away too. */}
        {formatUsed && !wide && (
          <div className="compose-footer__toolbar">
            <FormatToolbar editor={editor} open={formatting} />
          </div>
        )}
        {!wide && (draft.attachments.length > 0 || pending.length > 0) && (
          <ul className="compose-attachments" aria-label="Attachments">
            {draft.attachments.map((a) => (
              <li key={a.id} className="compose-att">
                {a.mimeType.startsWith('image/') && a.size < 4_000_000 && a.data ? (
                  <img className="compose-att__thumb" src={`data:${a.mimeType};base64,${a.data}`} alt="" />
                ) : (
                  <Icon name={fileIcon(a.mimeType, a.filename) as IconName} size={20} className="compose-att__icon" />
                )}
                <span className="compose-att__name" title={a.filename}>
                  {a.filename}
                </span>
                <span className="compose-att__size">{fileSize(a.size)}</span>
                <IconButton icon="close" size="xs" label={`Remove ${a.filename}`} onClick={() => update({ attachments: draft.attachments.filter((x) => x.id !== a.id) })} />
              </li>
            ))}
            {pending.map((p) => (
              <li key={p.id} className="compose-att compose-att--loading" aria-busy="true">
                <Icon name="attach_file" size={20} className="compose-att__icon" />
                <span className="compose-att__name">{p.filename}</span>
                <span className="compose-att__size">{p.size ? `${Math.round((p.loaded / p.size) * 100)}%` : ''}</span>
                <span
                  className="compose-att__progress"
                  role="progressbar"
                  aria-label={`Attaching ${p.filename}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={p.size ? Math.round((p.loaded / p.size) * 100) : 0}
                >
                  <span style={{ transform: `scaleX(${p.size ? p.loaded / p.size : 0})` }} />
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="compose-actions">
          <div className="split-button" role="group" aria-label="Send">
            <Tooltip content={draft.sendAt ? `Schedule send for ${fullTime(draft.sendAt)} (${keyLabel('⌘Enter')})` : `Send (${keyLabel('⌘Enter')})`}>
              <button
                type="submit"
                className="split-button__main m3-button m3-button--filled m3-size--s"
                aria-keyshortcuts={sendKeys}
                aria-label={draft.sendAt ? `Schedule send for ${fullTime(draft.sendAt)}` : undefined}
                data-scheduled={draft.sendAt ? '' : undefined}
              >
                {draft.sendAt && <Icon name="schedule_send" size={18} />}
                <span className="m3-button__label">{draft.sendAt ? scheduleTime(draft.sendAt) : 'Send'}</span>
              </button>
            </Tooltip>
            <BaseMenu.Root open={sendMenu} onOpenChange={setSendMenu}>
              <Tooltip content="More send options">
                <BaseMenu.Trigger className="split-button__menu m3-button m3-button--filled m3-size--s" aria-label="More send options" aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter">
                  <Icon name="keyboard_arrow_down" size={22} />
                </BaseMenu.Trigger>
              </Tooltip>
              <MenuPopup side="top" align="start" className="schedule-menu">
                <MenuGroupLabel>Schedule send</MenuGroupLabel>
                {caps.scheduleSend ? (
                  <>
                    {schedulePresets().map((p) => (
                      <MenuItem key={p.id} icon="schedule_send" onClick={() => pickSendAt(p.at)} trailing={<span className="menu-time">{scheduleTime(p.at)}</span>}>
                        {p.label}
                      </MenuItem>
                    ))}
                    <MenuItem icon="calendar_month" onClick={() => setPicking(true)}>
                      Pick date & time
                    </MenuItem>
                    {draft.sendAt && (
                      <MenuItem icon="close" onClick={() => update({ sendAt: undefined })}>
                        Don't schedule
                      </MenuItem>
                    )}
                  </>
                ) : (
                  <p className="menu-note md-body-small">
                    {kind === 'session' ? 'To schedule from this account, switch to it first.' : 'Scheduling needs the “Your Gmail session” connection (Settings > Connection).'}
                  </p>
                )}
                <MenuSeparator />
                <MenuGroupLabel>Send and follow up</MenuGroupLabel>
                <MenuItem icon="alarm_add" onClick={() => trySend({ remindInDays: 3 })} supporting="If nobody replies in 3 days">
                  Send with reminder
                </MenuItem>
              </MenuPopup>
            </BaseMenu.Root>
          </div>

          {!wide && <div className="compose-actions__group">
            <IconButton
              icon="text_format"
              label={formatting ? 'Hide formatting' : 'Show formatting'}
              selected={formatting}
              aria-expanded={formatting}
              onClick={() => {
                setFormatUsed(true);
                setFormatting((f) => !f);
              }}
            />
          </div>}
          <div className="compose-actions__group">
            <HelpMeWrite editor={editor} draft={draft} onSubject={(subject) => update({ subject })} />
            <IconButton icon="attach_file" label="Attach files" onClick={() => fileInput.current?.click()} />
            {!tiny && <IconButton icon="link" label="Insert link" tooltip={`Insert link (${keyLabel('⌘K')})`} aria-keyshortcuts={ariaKeys('⌘K')} onMouseDown={(e) => e.preventDefault()} onClick={openLink} />}
            {!narrow && <EmojiPicker open={emoji} onOpenChange={setEmoji} onPick={(e) => editor.current?.insertText(e)} />}
          </div>
          {!narrow && (
            <div className="compose-actions__group">
              <SignatureMenu editor={editor} />
              <TemplatesMenu
                draft={draft}
                onInsert={(html, subject) => {
                  editor.current?.insertHtml(html);
                  if (subject && !draft.subject) update({ subject });
                }}
              />
            </div>
          )}
          {narrow && (
            <BaseMenu.Root onOpenChange={(o) => o && setMoreSig(currentSignatureChoice(editor, signatures))}>
              <Tooltip content="More options">
                <BaseMenu.Trigger ref={moreRef} className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default" aria-label="More options">
                  <Icon name="more_vert" size={24} />
                </BaseMenu.Trigger>
              </Tooltip>
              <MenuPopup side="top" align="start">
                {tiny && (
                  <MenuItem icon="link" shortcut="Ctrl K" onClick={openLink}>
                    Insert link
                  </MenuItem>
                )}
                <MenuItem icon="mood" onClick={() => setEmoji(true)}>
                  Insert emoji
                </MenuItem>
                <Submenu icon="signature" label="Signature">
                  {signatureChoices({ editor, current: moreSig, signatures })}
                </Submenu>
                <Submenu icon="text_snippet" label="Templates">
                  {templateChoices({
                    templates,
                    draft,
                    onInsert: (html, subject) => {
                      editor.current?.insertHtml(html);
                      if (subject && !draft.subject) update({ subject });
                    },
                  })}
                </Submenu>
                {tight && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon="delete" onClick={() => void discardDraft(latest.current)}>
                      Discard draft
                    </MenuItem>
                  </>
                )}
              </MenuPopup>
            </BaseMenu.Root>
          )}
          {narrow && <EmojiPicker open={emoji} onOpenChange={setEmoji} onPick={(e) => editor.current?.insertText(e)} anchor={moreRef} withTrigger={false} />}
          <span className="compose-actions__spacer" />
          {!tight && <IconButton icon="delete" label="Discard draft" onClick={() => void discardDraft(latest.current)} />}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles([...e.target.files]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {drag !== null && (
        <div className="compose-drop" aria-hidden="true">
          <ShapeIcon shape="Cookie9Sided" icon="upload" size={88} iconSize={28} bg="var(--md-sys-color-primary)" fg="var(--md-sys-color-on-primary)" className="compose-drop__shape" />
          <span className="md-title-medium">{drag > 1 ? `Drop ${drag} files to attach` : 'Drop to attach'}</span>
        </div>
      )}

      <Dialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title="Send without a subject?"
        description="This message has no subject or text in the body."
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmEmpty(false)}>
              Cancel
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setConfirmEmpty(false);
                cancelDraftSave(draft.key);
                sendDraft(latest.current);
              }}
            >
              Send anyway
            </Button>
          </>
        }
      />
      <AttachmentReminder
        phrase={forgotten?.phrase ?? null}
        onCancel={() => setForgotten(null)}
        onAttach={() => {
          setForgotten(null);
          focusSendAfterAttach.current = true;
          fileInput.current?.click();
        }}
        onSendAnyway={() => {
          const opts = forgotten?.opts ?? {};
          setForgotten(null);
          trySend({ ...opts, attachmentChecked: true });
        }}
      />
      <DateTimeDialog
        open={picking}
        title="Pick date & time"
        confirmLabel="Set time"
        leadMs={SCHEDULE_LEAD_MS}
        onClose={() => setPicking(false)}
        onConfirm={(t) => {
          setPicking(false);
          pickSendAt(t);
        }}
      />
      <LinkDialog
        open={link !== null}
        initial={link ?? { text: '', href: '', editing: false }}
        onClose={() => {
          setLink(null);
          editor.current?.focus();
        }}
        onApply={(href, text) => editor.current?.setLink(href, text)}
        onRemove={() => editor.current?.removeLink()}
      />
    </form>
  );
}

/** A headline that wraps instead of scrolling sideways; still one line of text, and Enter moves on. */
function SubjectTitle({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="compose-subject compose-subject--title"
      rows={1}
      value={value}
      placeholder="Subject"
      aria-label="Subject"
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !isComposing(e)) {
          e.preventDefault();
          onDone();
        }
      }}
    />
  );
}

/** A plain function, so its separator starts a new menu section. */
function templateChoices({ onInsert, draft, templates }: { onInsert: (html: string, subject?: string) => void; draft: ComposeDraft; templates: Template[] }) {
  return (
    <>
      <MenuGroupLabel>Insert template</MenuGroupLabel>
      {templates.length === 0 && <p className="menu-note md-body-small">No templates yet. Save this draft as one, then type / in any message to insert it.</p>}
      {templates.map((t) => (
        <MenuItem key={t.id} onClick={() => onInsert(t.html, t.subject)} supporting={`Type /${t.shortcut} while writing`}>
          {t.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon="library_add" disabled={!stripHtml(draft.html).trim()} onClick={() => useUi.getState().set({ settingsSection: `templates:new:${draft.key}` })}>
        Save draft as template
      </MenuItem>
    </>
  );
}

function TemplatesMenu({ onInsert, draft }: { onInsert: (html: string, subject?: string) => void; draft: ComposeDraft }) {
  const templates = useSettings((s) => s.templates);
  return (
    <BaseMenu.Root>
      <Tooltip content="Templates">
        <BaseMenu.Trigger className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default" aria-label="Templates">
          <Icon name="text_snippet" />
        </BaseMenu.Trigger>
      </Tooltip>
      <MenuPopup side="top">
        {templateChoices({ onInsert, draft, templates })}
      </MenuPopup>
    </BaseMenu.Root>
  );
}
