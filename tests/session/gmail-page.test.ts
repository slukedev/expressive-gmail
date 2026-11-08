import { GmailPage, GmailPageError } from '../../src/session/gmail-page';
import { composeUrlId } from '../../src/session/ids';

type Row = {
  id: string;
  folder: 'trash' | 'spam' | 'inbox' | 'drafts' | 'scheduled' | 'discarded';
  messageId?: string;
  sendAt?: number;
  /** Recipients as saved; Gmail's page shows them once it has synced `syncsNeeded` times. */
  to?: string[];
  syncsNeeded?: number;
};

interface ScheduleOptions {
  /** Gmail's preset times in its Schedule send dialog. */
  presets?: number[];
  /** Pressing Schedule send in the menu does nothing. */
  noDialog?: boolean;
  /** The page's language; labels are French for 'fr'. */
  lang?: 'en-US' | 'fr';
  /** How Gmail reads its date and time fields; Date.parse by default. */
  parse?: (date: string, time: string) => number;
  /** Times Gmail's field reads; anything else it marks invalid, with its own message. */
  readsTime?: (time: string) => boolean;
  /** The arrow beside Send does nothing; Schedule send sits in the compose, hidden, as InboxSDK finds it. */
  deadArrow?: boolean;
  /** Gmail stops answering after this step: the dialog opens and nothing else does. */
  hangAfterDialog?: boolean;
  /** Gmail ignores the first press of the dialog's Schedule send, as it can while still reading its fields. */
  ignoreFirstConfirm?: boolean;
  /** Another of Gmail's dialogs is already up (a tip, a leftover), with a choice of its own. */
  strayDialog?: boolean;
  /** Gmail's copy of the draft has nobody in To, so Schedule send answers with an error. */
  noRecipients?: boolean;
  /** Gmail never answers the dialog's Schedule send. */
  deadConfirm?: boolean;
  /** Gmail asks before scheduling ("Send this message without a subject?"), or reports a problem with just OK. */
  afterConfirm?: 'question' | 'problem';
}

/**
 * A stand-in for Gmail's page with the parts the driver touches: list rows
 * with checkboxes, the toolbar's Delete forever, the folder's empty link and
 * the confirm dialog. Like Gmail it acts a beat after the click, pages its
 * lists (`#trash/p2`), keeps the previous list in the page but hidden, and
 * only re-renders on a real navigation, not on replaceState.
 */
function fakeGmail(
  rows: Row[],
  options: {
    english?: boolean;
    confirmDelete?: boolean;
    perPage?: number;
    ignoreEmpty?: boolean;
    wake?: () => () => void;
    schedule?: ScheduleOptions;
    /** Rows Gmail shows already selected (left ticked by something else). */
    ticked?: string[];
  } = {},
) {
  const english = options.english ?? true;
  const perPage = options.perPage ?? 50;
  const doc = document.implementation.createHTMLDocument('Gmail');
  const sched = options.schedule ?? {};
  const fr = sched.lang === 'fr';
  doc.documentElement.lang = sched.lang ?? 'en-US';
  const toast = doc.body.appendChild(doc.createElement('div'));
  toast.className = 'b8';
  toast.setAttribute('role', 'alert');
  toast.innerHTML = '<div class="vh"></div>';
  const say = (text: string) => (toast.querySelector('.vh')!.textContent = text);
  /** Every press of Gmail's own Send button; there should be none. */
  const sentNow: string[] = [];
  let shownHash = '#inbox';
  const location = {
    href: 'https://mail.google.com/mail/u/0/#inbox',
    get hash() {
      return new URL(this.href).hash;
    },
    replace(url: string) {
      const changed = new URL(url).hash !== this.hash;
      this.href = url;
      if (changed) later(render);
    },
  };
  const history = {
    state: null,
    // The app mirrors its route this way; Gmail doesn't notice.
    replaceState(_state: unknown, _title: string, url: string) {
      location.href = new URL(url, location.href).toString();
    },
  };
  const win = { document: doc, location, history } as unknown as Window;
  let live = [...rows];
  const later = (fn: () => void) => setTimeout(fn, 20);
  let syncs = 0;
  /** Where each Refresh was pressed. */
  const synced: string[] = [];

  function render() {
    shownHash = location.hash;
    const [path = '', query = ''] = shownHash.slice(1).split('?');
    const [folder, pageName] = path.split('/');
    const page = pageName ? Number(pageName.slice(1)) : 1;
    // The previous list stays in the page, hidden.
    doc.querySelectorAll('[data-view]').forEach((v) => v.setAttribute('hidden', ''));
    doc.querySelectorAll('[role="alertdialog"], [data-toolbar]').forEach((el) => el.remove());
    doc.querySelector(`[data-view="${shownHash}"]`)?.remove();
    const main = doc.querySelector('[role="main"]') ?? doc.body.appendChild(Object.assign(doc.createElement('div'), {}));
    main.setAttribute('role', 'main');
    const view = doc.createElement('div');
    view.dataset.view = shownHash;
    const table = doc.createElement('table');
    const inFolder = live.filter((x) => x.folder === folder);
    for (const r of inFolder.slice((page - 1) * perPage, page * perPage)) {
      const tr = doc.createElement('tr');
      tr.className = 'zA';
      tr.innerHTML = `<td><div role="checkbox" aria-checked="${!!options.ticked?.includes(r.id)}"></div></td><td><span data-thread-id="#${r.id}">Subject</span></td>`;
      const box = tr.querySelector('[role="checkbox"]')!;
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        box.setAttribute('aria-checked', box.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      });
      if (folder === 'scheduled') tr.addEventListener('click', () => later(() => openScheduled(r)));
      table.append(tr);
    }
    view.append(table);
    if ((folder === 'trash' || folder === 'spam') && inFolder.length) {
      const link = doc.createElement('span');
      link.setAttribute('role', 'button');
      link.textContent = english ? (folder === 'trash' ? 'Empty Trash now' : 'Delete all spam messages now') : 'Vider la corbeille';
      link.addEventListener('click', () => later(() => confirm(() => !options.ignoreEmpty && (live = live.filter((x) => x.folder !== folder)))));
      view.append(link);
    }
    main.append(view);
    const del = doc.createElement('div');
    del.dataset.toolbar = '';
    del.setAttribute('role', 'button');
    del.setAttribute('aria-label', english ? 'Delete forever' : 'Supprimer définitivement');
    del.addEventListener('click', () => {
      const checked = [...view.querySelectorAll('tr')].filter((tr) => tr.querySelector('[aria-checked="true"]')).map((tr) => tr.querySelector('[data-thread-id]')!.getAttribute('data-thread-id')!.slice(1));
      const remove = () => {
        live = live.filter((x) => !checked.includes(x.id));
        render();
      };
      later(() => (options.confirmDelete ? confirm(remove) : remove()));
    });
    doc.body.append(del);
    // Gmail's Refresh: its page syncs, catching up with drafts saved elsewhere.
    const refresh = doc.createElement('div');
    refresh.dataset.toolbar = '';
    refresh.setAttribute('role', 'button');
    refresh.setAttribute('aria-label', english ? 'Refresh' : 'Actualiser');
    refresh.addEventListener('click', () => {
      syncs++;
      synced.push(location.hash);
    });
    doc.body.append(refresh);
    const composeId = new URLSearchParams(query).get('compose');
    const draft = composeId && live.find((x) => x.folder === 'drafts' && x.messageId && composeUrlId(x.id, x.messageId) === composeId);
    if (draft) openCompose(draft);
  }

  /** Gmail's floating compose window, with the hidden draft field, Send and More send options. */
  function openCompose(r: Row) {
    const win = doc.createElement('div');
    win.setAttribute('role', 'dialog');
    win.dataset.compose = r.id;
    const chips = syncs >= (r.syncsNeeded ?? 0) ? (r.to ?? []).map((a) => `<span class="aQ2" email="${a}" data-hovercard-id="${a}">${a}</span>`).join('') : '';
    win.innerHTML = `<div class="Hm"><img alt=""><img alt=""><img class="Ha" alt=""></div>
      <div class="M9"><div class="recipients" name="to">${chips}</div><form><input type="hidden" name="composeid" value="c1"><input type="hidden" name="draft" value="#${r.messageId}"></form>
      <div class="IZ"><div class="Up"><div><div role="button" class="T-I aoO" data-tooltip="Send">${fr ? 'Envoyer' : 'Send'}</div><div role="button" class="T-I hG" aria-haspopup="true" aria-label="${fr ? "Plus d'options d'envoi" : 'More send options'}"></div></div></div>
      <div role="button" class="og T-I-J3" data-tooltip="${fr ? 'Supprimer le brouillon' : 'Discard draft \u202a(⌘⇧D)\u202c'}"></div></div></div>`;
    const close = () => win.remove();
    win.querySelectorAll('.Hm > img')[2]!.addEventListener('click', close);
    win.querySelector('.aoO')!.addEventListener('click', () => sentNow.push(r.id));
    win.querySelector('.og')!.addEventListener('click', () => later(() => ((r.folder = 'discarded'), win.remove())));
    if (sched.deadArrow) {
      const menu = doc.createElement('div');
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      menu.innerHTML = `<div role="menuitem" class="J-N yr" selector="scheduledSend">Schedule send</div>`;
      menu.firstElementChild!.addEventListener('click', () => later(() => scheduleDialog(r, win)));
      win.append(menu);
      doc.body.append(win);
      return;
    }
    win.querySelector('.hG')!.addEventListener('click', () =>
      later(() => {
        const menu = doc.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `<div role="menuitem" class="J-N yr" selector="scheduledSend">${fr ? "Programmer l'envoi" : 'Schedule send'}</div>`;
        menu.firstElementChild!.addEventListener('click', () => {
          menu.remove();
          if (sched.noRecipients) {
            later(() => {
              const q = doc.createElement('div');
              q.setAttribute('role', 'alertdialog');
              q.innerHTML = '<span>Error</span><span>Please specify at least one recipient.</span><button name="ok">OK</button>';
              q.querySelector('[name="ok"]')!.addEventListener('click', () => later(() => q.remove()));
              doc.body.append(q);
            });
          } else if (!sched.noDialog) later(() => scheduleDialog(r, win));
        });
        win.append(menu);
      }),
    );
    doc.body.append(win);
  }

  function modal(label: string) {
    const d = doc.createElement('div');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', label);
    d.addEventListener('keydown', (e) => e.key === 'Escape' && d.remove());
    doc.body.append(d);
    return d;
  }

  function scheduled(r: Row, at: number, compose: HTMLElement) {
    r.folder = 'scheduled';
    r.sendAt = at;
    compose.remove();
    say(`Send scheduled for ${new Date(at).toString()}`);
  }

  const fmt = (at: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(doc.documentElement.lang, o).format(at);

  function scheduleDialog(r: Row, compose: HTMLElement) {
    const d = modal(fr ? "Programmer l'envoi" : 'Schedule send');
    for (const at of sched.presets ?? []) {
      const item = doc.createElement('div');
      item.setAttribute('role', 'menuitem');
      item.innerHTML = `<div>${fr ? 'Demain matin' : 'Tomorrow morning'}</div><div>${fmt(at, { month: 'short', day: 'numeric' })}, ${fmt(at, { hour: 'numeric', minute: '2-digit' })}</div>`;
      item.addEventListener('click', () =>
        later(() => {
          d.remove();
          scheduled(r, at, compose);
        }),
      );
      d.append(item);
    }
    if (sched.hangAfterDialog) {
      d.insertAdjacentHTML('beforeend', '<div role="menuitem">Tomorrow morning</div><div role="menuitem">Monday morning</div>');
      return;
    }
    const pick = doc.createElement('div');
    pick.setAttribute('role', 'menuitem');
    pick.innerHTML = `<span>${fr ? "Choisir la date et l'heure" : 'Pick date & time'}</span>`;
    pick.addEventListener('click', () =>
      later(() => {
        d.remove();
        picker(r, compose);
      }),
    );
    d.append(pick);
    d.insertAdjacentHTML('beforeend', `<button name="cancel">${fr ? 'Annuler' : 'Cancel'}</button>`);
  }

  function picker(r: Row, compose: HTMLElement) {
    const d = modal(fr ? "Choisir la date et l'heure" : 'Pick date & time');
    d.innerHTML = `<div role="button" aria-label="Next month"></div><input type="text" aria-label="${fr ? 'Date' : 'Date'}" value="Jan 1, 2000"><input type="text" aria-label="${fr ? 'Heure' : 'Time'}" value="9:00 AM">
      <button name="cancel">${fr ? 'Annuler' : 'Cancel'}</button><button name="ok" disabled>${fr ? "Programmer l'envoi" : 'Schedule send'}</button>`;
    const [date, time] = [...d.querySelectorAll('input')];
    const ok = d.querySelector<HTMLButtonElement>('[name="ok"]')!;
    const parse = sched.parse ?? ((a: string, b: string) => Date.parse(`${a} ${b}`));
    let at = NaN;
    // Like Gmail, the fields are read when they change.
    for (const input of [date!, time!]) {
      input.addEventListener('change', () => {
        at = parse(date!.value, time!.value);
        ok.disabled = Number.isNaN(at);
      });
    }
    if (sched.readsTime) {
      time!.setAttribute('aria-describedby', 'time-error');
      const error = d.appendChild(doc.createElement('div'));
      error.id = 'time-error';
      time!.addEventListener('change', () => {
        const bad = !sched.readsTime!(time!.value);
        time!.setAttribute('aria-invalid', String(bad));
        error.textContent = bad ? 'Invalid time' : '';
      });
    }
    let ignore = !!sched.ignoreFirstConfirm;
    ok.addEventListener('click', () => {
      if (ignore) return void (ignore = false);
      if (sched.deadConfirm) return;
      later(() => {
        d.remove();
        if (sched.afterConfirm === 'question') {
          const q = doc.createElement('div');
          q.setAttribute('role', 'alertdialog');
          q.innerHTML = '<span>Send this message without a subject or text in the body?</span><button name="cancel">Cancel</button><button name="ok">OK</button>';
          q.querySelector('[name="ok"]')!.addEventListener('click', () => later(() => (q.remove(), scheduled(r, at, compose))));
          doc.body.append(q);
        } else if (sched.afterConfirm === 'problem') {
          const q = doc.createElement('div');
          q.setAttribute('role', 'alertdialog');
          q.innerHTML = '<div role="button" aria-label="Close"></div><span>Error</span><span>Please specify at least one recipient.</span><button name="ok">OK</button>';
          q.querySelector('[name="ok"]')!.addEventListener('click', () => later(() => q.remove()));
          doc.body.append(q);
        } else scheduled(r, at, compose);
      });
    });
  }

  /** The scheduled message's view, with Gmail's Cancel send; cancelling reopens it as a draft. */
  function openScheduled(r: Row) {
    doc.querySelectorAll('[data-view]').forEach((v) => v.setAttribute('hidden', ''));
    const view = doc.createElement('div');
    view.dataset.view = `thread:${r.id}`;
    view.innerHTML = `<div>Send scheduled</div><div role="button">${fr ? "Annuler l'envoi" : 'Cancel send'}</div>`;
    view.querySelector('[role="button"]')!.addEventListener('click', () =>
      later(() => {
        r.folder = 'drafts';
        delete r.sendAt;
        view.remove();
        say('Sending cancelled.');
        openCompose(r);
      }),
    );
    doc.querySelector('[role="main"]')!.append(view);
  }

  function confirm(onOk: () => void) {
    const dialog = doc.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.innerHTML = '<button name="cancel">Cancel</button><button name="ok">OK</button>';
    dialog.querySelector('[name="ok"]')!.addEventListener('click', () =>
      later(() => {
        onOk();
        render();
      }),
    );
    doc.body.append(dialog);
  }

  render();
  if (sched.strayDialog) doc.body.insertAdjacentHTML('afterbegin', '<div role="dialog" aria-label="Tip"><div role="menuitem">Got it</div><div role="button">Learn more</div></div>');
  const page = new GmailPage({
    window: win,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    stepTimeoutMs: 600,
    shown: (el) => !el.closest('[hidden]'),
    ...(options.wake ? { wake: options.wake } : {}),
  });
  const ids = (folder: string) => live.filter((x) => x.folder === folder).map((x) => x.id);
  /** What the sync API would report for the folder's first page. */
  const view = (folder: 'trash' | 'spam') => ({ landmarks: ids(folder).slice(0, 100), total: ids(folder).length });
  const composes = () => [...doc.querySelectorAll('[data-compose]')];
  return { page, live: () => live, location, history, doc, view, shownHash: () => shownHash, sentNow, composes, synced };
}

const trash = (n: number, from = 1): Row[] => Array.from({ length: n }, (_, i) => ({ id: `thread-f:${from + i}`, folder: 'trash' }));

describe('GmailPage', () => {
  it('ticks only the requested rows in Trash, presses Delete forever and waits for them to go', async () => {
    const g = fakeGmail([...trash(3), { id: 'thread-f:9', folder: 'spam' }]);
    const missing = await g.page.deleteForever(['thread-f:1', 'thread-f:3'], 'trash', g.view('trash'));
    expect(missing).toEqual([]);
    expect(g.live().map((r) => r.id)).toEqual(['thread-f:2', 'thread-f:9']);
  });

  it('deletes nothing when Gmail has another conversation selected, and clears that selection', async () => {
    const g = fakeGmail(trash(3), { ticked: ['thread-f:2'] });
    await expect(g.page.deleteForever(['thread-f:1'], 'trash', g.view('trash'))).rejects.toThrow('other conversations selected');
    expect(g.live().map((r) => r.id)).toEqual(['thread-f:1', 'thread-f:2', 'thread-f:3']);
    expect(g.doc.querySelectorAll('[data-view="#trash"] [aria-checked="true"]')).toHaveLength(0);
  });

  it('really navigates Gmail when the app already put #trash in the URL without Gmail seeing it', async () => {
    const g = fakeGmail([...trash(2), { id: 'thread-f:50', folder: 'inbox' }]);
    g.history.replaceState(null, '', '#trash');
    expect(g.shownHash()).toBe('#inbox');
    await g.page.emptyFolder('trash', g.view('trash'));
    expect(g.shownHash()).toBe('#trash');
    expect(g.live().map((r) => r.id)).toEqual(['thread-f:50']);
  });

  it('ignores rows of the hidden list Gmail keeps from the previous view', async () => {
    const g = fakeGmail([...trash(1), { id: 'thread-f:50', folder: 'inbox' }]);
    await g.page.emptyFolder('trash', g.view('trash'));
    // The inbox's hidden rows are still in the page; only Trash's counted.
    expect(g.doc.querySelectorAll('tr.zA')).toHaveLength(1);
    expect(g.live().map((r) => r.id)).toEqual(['thread-f:50']);
  });

  it('walks Gmail\'s list pages to find a selection beyond the first', async () => {
    const g = fakeGmail(trash(7), { perPage: 3 });
    const missing = await g.page.deleteForever(['thread-f:2', 'thread-f:7'], 'trash', g.view('trash'));
    expect(missing).toEqual([]);
    expect(g.live().map((r) => r.id)).toEqual(['thread-f:1', 'thread-f:3', 'thread-f:4', 'thread-f:5', 'thread-f:6']);
  });

  it('answers Gmail\'s confirm dialog when it asks, and reports ids the list never showed', async () => {
    const g = fakeGmail([{ id: 'thread-f:1', folder: 'spam' }], { confirmDelete: true });
    const missing = await g.page.deleteForever(['thread-f:1', 'thread-a:r55'], 'spam', g.view('spam'));
    expect(missing).toEqual(['thread-a:r55']);
    expect(g.live()).toEqual([]);
  });

  it('empties every page of Trash through Empty Trash now and its confirmation, leaving Spam alone', async () => {
    const g = fakeGmail([...trash(120), { id: 'thread-f:900', folder: 'spam' }]);
    await g.page.emptyFolder('trash', g.view('trash'));
    expect(g.live().map((r) => r.id)).toEqual(['thread-f:900']);
  });

  it('presses nothing when the sync API saw an empty folder', async () => {
    const g = fakeGmail([{ id: 'thread-f:9', folder: 'spam' }]);
    await expect(g.page.emptyFolder('trash', g.view('trash'))).resolves.toBeUndefined();
    expect(g.shownHash()).toBe('#inbox');
  });

  it('fails with a plain error, touching nothing, when Gmail is in another language', async () => {
    const g = fakeGmail(trash(1), { english: false });
    await expect(g.page.deleteForever(['thread-f:1'], 'trash', g.view('trash'))).rejects.toBeInstanceOf(GmailPageError);
    // The row it ticked is unticked again.
    expect(g.doc.querySelector('[data-view="#trash"] [role="checkbox"]')?.getAttribute('aria-checked')).toBe('false');
    await expect(g.page.emptyFolder('trash', g.view('trash'))).rejects.toThrow(/didn't respond in time/);
    expect(g.live()).toHaveLength(1);
  });

  it('does not report success when the rows stay after OK', async () => {
    const g = fakeGmail(trash(2), { ignoreEmpty: true });
    await expect(g.page.emptyFolder('trash', g.view('trash'))).rejects.toThrow(/couldn't empty the folder/);
  });

  it('wakes Gmail\'s resting page for each action and puts it back to rest, even when the action fails', async () => {
    let awake = false;
    let pressedWhileAwake = false;
    const g = fakeGmail(trash(1), {
      wake: () => {
        awake = true;
        return () => (awake = false);
      },
    });
    g.doc.addEventListener('click', () => (pressedWhileAwake = awake), true);
    await g.page.deleteForever(['thread-f:1'], 'trash', g.view('trash'));
    expect(pressedWhileAwake).toBe(true);
    expect(awake).toBe(false);

    const french = fakeGmail(trash(1, 2), { english: false, wake: () => ((awake = true), () => (awake = false)) });
    await expect(french.page.deleteForever(['thread-f:2'], 'trash', french.view('trash'))).rejects.toBeInstanceOf(GmailPageError);
    expect(awake).toBe(false);
  });

  it('runs one action at a time, so two requests never steer the page at once', async () => {
    const g = fakeGmail([...trash(1), { id: 'thread-f:9', folder: 'spam' }]);
    await Promise.all([g.page.deleteForever(['thread-f:1'], 'trash', g.view('trash')), g.page.deleteForever(['thread-f:9'], 'spam', g.view('spam'))]);
    expect(g.live()).toEqual([]);
  });
});

describe('GmailPage schedule send', () => {
  const draft = (n = 1): Row => ({ id: `thread-a:r${n}`, messageId: `msg-a:r${100 + n}`, folder: 'drafts' });
  // Whole minutes, in the future, in this machine's time zone.
  const at = new Date(2031, 2, 14, 19, 30).getTime();
  const request = (r: Row, sendAt = at) => ({ threadId: r.id, messageId: r.messageId!, sendAt });

  it('opens the draft, picks the date and time in Gmail\'s fields and presses Schedule send, never Send', async () => {
    const r = draft();
    const g = fakeGmail([r]);
    await g.page.scheduleDraft(request(r));
    expect(g.shownHash()).toBe(`#drafts?compose=${composeUrlId(r.id, r.messageId!)}`);
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
    expect(g.sentNow).toEqual([]);
    expect(g.composes()).toHaveLength(0);
  });

  it('presses Gmail\'s own preset when it names exactly the time picked', async () => {
    const r = draft();
    const morning = new Date(2031, 2, 15, 8, 0).getTime();
    const g = fakeGmail([r], { schedule: { presets: [morning - 86_400_000, morning], parse: () => NaN } });
    await g.page.scheduleDraft(request(r, morning));
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: morning });
  });

  it('finds its way without English labels, typing the date the way the page\'s language writes it', async () => {
    const r = draft();
    const typed: string[] = [];
    const parse = (date: string, time: string) => {
      typed.splice(0, 2, date, time);
      const want = [new Intl.DateTimeFormat('fr', { year: 'numeric', month: 'short', day: 'numeric' }).format(at), new Intl.DateTimeFormat('fr', { hour: 'numeric', minute: '2-digit' }).format(at)];
      return date === want[0]!.replace(/\s+/g, ' ') && time === want[1] ? at : NaN;
    };
    const g = fakeGmail([r], { schedule: { lang: 'fr', parse } });
    await g.page.scheduleDraft(request(r));
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
    expect(typed[1]).toBe('19:30');
  });

  it('presses Schedule send where it sits when the arrow beside Send won\'t open its menu', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { deadArrow: true } });
    await g.page.scheduleDraft(request(r));
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
    expect(g.sentNow).toEqual([]);
  });

  it('puts the address back the way the app had it, so a reload doesn\'t reopen the draft', async () => {
    const r = draft();
    const g = fakeGmail([r]);
    g.history.replaceState(null, '', '#inbox/thread-f:1');
    await g.page.scheduleDraft(request(r));
    expect(g.location.hash).toBe('#inbox/thread-f:1');
    // and a second schedule still really navigates Gmail
    const r2 = draft(2);
    g.live().push(r2);
    await g.page.scheduleDraft(request(r2));
    expect(r2.folder).toBe('scheduled');
  });

  it('leaves the address alone when the app moved to another route while Gmail was scheduling', async () => {
    const r = draft();
    const g = fakeGmail([r]);
    g.history.replaceState(null, '', '#inbox');
    const done = g.page.scheduleDraft(request(r));
    // The app mirrors a route change into the URL mid-action, once Gmail has the draft open.
    await vi.waitFor(() => expect(g.composes()).toHaveLength(1));
    g.history.replaceState(null, '', '#sent/thread-f:7');
    await done;
    expect(r.folder).toBe('scheduled');
    expect(g.location.hash).toBe('#sent/thread-f:7');
  });

  it('gives up on a stuck Gmail with the step it was on, closing what it opened', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { hangAfterDialog: true } });
    const err = await g.page.scheduleDraft(request(r)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailPageError);
    expect((err as GmailPageError).step).toBe('find Pick date & time');
    expect(r.folder).toBe('drafts');
    expect(g.composes()).toHaveLength(0);
    expect(g.doc.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(g.sentNow).toEqual([]);
  });

  it('presses Schedule send once more when Gmail ignored the first press, and schedules it once', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { ignoreFirstConfirm: true } });
    await g.page.scheduleDraft(request(r));
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
    expect(g.sentNow).toEqual([]);
    expect(g.composes()).toHaveLength(0);
  });

  it('says what Gmail showed when it never takes the press, for the diagnostics log', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { deadConfirm: true } });
    const err = (await g.page.scheduleDraft(request(r)).catch((e: unknown) => e)) as GmailPageError;
    expect(err.step).toBe('schedule the message');
    expect(err.message).toMatch(/pressed button "Schedule send", now shown; draft still open; notice "" \(unchanged\); dialogs: dialog "Pick date & time" \(Date="[^"]+", Time="[^"]+"\)/);
    expect(r.folder).toBe('drafts');
  });

  it('works in Schedule send\'s own dialog when another of Gmail\'s is already up', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { strayDialog: true } });
    await g.page.scheduleDraft(request(r));
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
    expect(g.sentNow).toEqual([]);
  });

  it('types the time the way Gmail reads it when it marks the first try invalid', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { readsTime: (t) => /^\d\d:\d\d$/.test(t) } });
    await g.page.scheduleDraft(request(r));
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
  });

  it('stops with Gmail\'s words when it reads no spelling of the time, without pressing Schedule send', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { readsTime: () => false } });
    const err = (await g.page.scheduleDraft(request(r)).catch((e: unknown) => e)) as GmailPageError;
    expect(err.said).toBe('Invalid time');
    expect(r.folder).toBe('drafts');
    expect(g.composes()).toHaveLength(0);
    expect(g.sentNow).toEqual([]);
  });

  it('stops with Gmail\'s words, not a timeout, when Gmail refuses to open Schedule send', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { noRecipients: true } });
    const err = (await g.page.scheduleDraft(request(r)).catch((e: unknown) => e)) as GmailPageError;
    expect(err.said).toBe('Please specify at least one recipient.');
    expect(r.folder).toBe('drafts');
    expect(g.composes()).toHaveLength(0);
    // Its OK was pressed, so Gmail's page is left as it was.
    await vi.waitFor(() => expect(g.doc.querySelectorAll('[role="alertdialog"]')).toHaveLength(0));
  });

  it('refreshes Gmail\'s Drafts first, and reopens a draft whose recipients Gmail\'s page hasn\'t caught up with', async () => {
    const r: Row = { ...draft(), to: ['grace@example.org'], syncsNeeded: 2 };
    const g = fakeGmail([r]);
    await g.page.scheduleDraft({ ...request(r), recipients: ['Grace@example.org'] });
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
    expect(g.synced).toEqual(['#drafts', '#drafts']);
    expect(g.sentNow).toEqual([]);
  });

  it('never schedules a copy of the draft that lacks a recipient, and says to try again', async () => {
    const r: Row = { ...draft(), to: ['old@example.org'], syncsNeeded: 0 };
    const g = fakeGmail([r]);
    const err = (await g.page.scheduleDraft({ ...request(r), recipients: ['grace@example.org'] }).catch((e: unknown) => e)) as GmailPageError;
    expect(err.said).toMatch(/hasn't caught up with this draft's recipients yet/);
    expect(err.message).toMatch(/missing grace@example\.org/);
    expect(r.folder).toBe('drafts');
    expect(g.composes()).toHaveLength(0);
  });

  it('answers Gmail\'s own question with OK and schedules it', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { afterConfirm: 'question' } });
    await g.page.scheduleDraft(request(r));
    expect(r).toMatchObject({ folder: 'scheduled', sendAt: at });
    expect(g.sentNow).toEqual([]);
    expect(g.doc.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
  });

  it('stops with Gmail\'s words when it reports a problem, closing what it opened', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { afterConfirm: 'problem' } });
    const err = await g.page.scheduleDraft(request(r)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailPageError);
    expect((err as GmailPageError).said).toBe('Please specify at least one recipient.');
    expect(r.folder).toBe('drafts');
    expect(g.composes()).toHaveLength(0);
    expect(g.sentNow).toEqual([]);
  });

  it('fails plainly when Gmail can\'t open the draft, touching nothing', async () => {
    const r = draft();
    const g = fakeGmail([{ ...r, folder: 'inbox' }]);
    await expect(g.page.scheduleDraft(request(r))).rejects.toThrow(/couldn't open the draft/);
    expect(g.sentNow).toEqual([]);
  });

  it('fails when Schedule send never opens its dialog, closing the draft it opened and sending nothing', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { noDialog: true } });
    await expect(g.page.scheduleDraft(request(r))).rejects.toThrow(/couldn't open Schedule send/);
    expect(r.folder).toBe('drafts');
    expect(g.sentNow).toEqual([]);
    expect(g.composes()).toHaveLength(0);
  });

  it('fails when Gmail won\'t take the date and time, and closes its dialogs', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { parse: () => NaN } });
    await expect(g.page.scheduleDraft(request(r))).rejects.toThrow(/couldn't accept the date and time/);
    expect(r.folder).toBe('drafts');
    expect(g.doc.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it('cancels a send from Scheduled with Gmail\'s Cancel send and closes the draft Gmail reopens', async () => {
    const r: Row = { ...draft(), folder: 'scheduled', sendAt: at };
    const g = fakeGmail([{ id: 'thread-f:9', folder: 'scheduled' }, r]);
    await g.page.cancelSend(r.id, { landmarks: ['thread-f:9', r.id], total: 2 });
    expect(r.folder).toBe('drafts');
    expect(g.composes()).toHaveLength(0);
    expect(g.sentNow).toEqual([]);
  });

  it('says so when the scheduled message isn\'t in Gmail\'s Scheduled folder', async () => {
    const g = fakeGmail([{ id: 'thread-f:9', folder: 'scheduled' }]);
    await expect(g.page.cancelSend('thread-a:r1', { landmarks: ['thread-f:9'], total: 1 })).rejects.toThrow(/Scheduled folder/);
  });
});

describe('GmailPage discard draft', () => {
  const draft = (): Row => ({ id: 'thread-a:r1', messageId: 'msg-a:r101', folder: 'drafts' });

  it('opens the draft and presses its bin, sending nothing', async () => {
    const r = draft();
    const g = fakeGmail([r]);
    await g.page.discardDraft({ threadId: r.id, messageId: r.messageId! });
    expect(r.folder).toBe('discarded');
    expect(g.composes()).toHaveLength(0);
    expect(g.sentNow).toEqual([]);
  });

  it('finds the bin by its place when Gmail names it in another language', async () => {
    const r = draft();
    const g = fakeGmail([r], { schedule: { lang: 'fr' } });
    await g.page.discardDraft({ threadId: r.id, messageId: r.messageId! });
    expect(r.folder).toBe('discarded');
  });
});

describe('composeUrlId', () => {
  it('matches InboxSDK\'s encoding of a draft for #drafts?compose=', () => {
    expect(composeUrlId('thread-f:1689835521506698369', 'msg-a:r-4437691956637862407')).toBe('CqMvqmRLbRhtqczNhFhkDQPRFTQBHmDpFpKtPVWGdZHFgscZcWpMKGJpSjgpgpvdSbRMRTSpSxB');
  });
});
