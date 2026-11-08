// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { geminiAvailable, geminiOn, geminiRecheckMs, type GeminiStatus } from '../../src/app/data/gemini';
import { fromStorage } from '../../src/app/state/settings';
import { BackendError, type MailBackend } from '../../src/app/data/backend';
import { queryClient, setBackend } from '../../src/app/data/client';
import { GEMINI_UNAVAILABLE, geminiErrorText, geminiKeys, readGeminiStatus, runGemini } from '../../src/app/features/gemini/useGemini';

const READY: GeminiStatus = { ready: true, features: ['chat', 'summary', 'write'] };
const PLAN: GeminiStatus = { ready: false, block: 'plan' };
const LOADING: GeminiStatus = { ready: false, block: 'page', detail: "Gmail's page hasn't finished loading here." };
const API: GeminiStatus = { ready: false, block: 'connection' };

describe('the Gemini switch', () => {
  it('untouched, follows what Gmail shows, both ways', () => {
    expect(geminiOn(null, READY)).toBe(true);
    expect(geminiOn(null, PLAN)).toBe(false);
    // Gmail turns Gemini on for the account later (a plan bought, smart features on): it follows.
    expect([PLAN, LOADING, READY].map((s) => geminiOn(null, s))).toEqual([false, false, true]);
    // And off again when Gmail stops showing it.
    expect([READY, PLAN].map((s) => geminiOn(null, s))).toEqual([true, false]);
  });

  it('turned off, stays off even though Gmail has Gemini on', () => {
    expect(geminiOn(false, READY)).toBe(false);
    expect([PLAN, READY, READY].map((s) => geminiOn(false, s))).toEqual([false, false, false]);
  });

  it('turned on, still shows nothing on an account Gmail has no Gemini for', () => {
    expect(geminiOn(true, PLAN)).toBe(false);
    expect(geminiOn(true, API)).toBe(false);
    // Unknown (still asking, or the ask failed) is off.
    expect(geminiOn(true, undefined)).toBe(false);
    expect(geminiOn(true, READY)).toBe(true);
  });

  it('is available only when Gmail shows Gemini', () => {
    expect([READY, PLAN, LOADING, API, undefined].map(geminiAvailable)).toEqual([true, false, false, false, false]);
  });
});

describe('looking again', () => {
  it('asks again soon after a no, less often after a yes, and never for a source with no Gemini', () => {
    const no = geminiRecheckMs(LOADING);
    const yes = geminiRecheckMs(READY);
    expect(no).toBeGreaterThan(0);
    expect(yes).toBeGreaterThan(no as number);
    expect(geminiRecheckMs(PLAN)).toBe(no);
    // A failed ask reads as a no.
    expect(geminiRecheckMs(undefined)).toBe(no);
    expect(geminiRecheckMs(API)).toBe(false);
  });
});

describe('the stored setting', () => {
  it('starts untouched', () => {
    expect(fromStorage(undefined).geminiChoice).toBeNull();
    expect(fromStorage({}).geminiChoice).toBeNull();
  });

  it('keeps an old "off" as a choice, and lets an old default "on" follow Gmail', () => {
    expect(fromStorage({ gemini: false }).geminiChoice).toBe(false);
    expect(fromStorage({ gemini: true }).geminiChoice).toBeNull();
    expect('gemini' in fromStorage({ gemini: false })).toBe(false);
  });

  it('keeps a choice once made, over an old key, and drops one that isn’t a yes or no', () => {
    expect(fromStorage({ geminiChoice: true, gemini: false }).geminiChoice).toBe(true);
    expect(fromStorage({ geminiChoice: false }).geminiChoice).toBe(false);
    expect(fromStorage({ geminiChoice: 'yes' }).geminiChoice).toBeNull();
  });
});

describe('when Gmail turns out not to have it', () => {
  it('a run Gmail refuses says so in a few words and makes the app look at Gmail again', async () => {
    const gone = "Gmail here has no Gemini side panel (Ask Gemini, top right). Gemini comes with Google AI plans and some Workspace plans.";
    // Node has no frames; runGemini cancels one when it settles.
    globalThis.cancelAnimationFrame ??= () => undefined;
    setBackend({ geminiStatus: async () => PLAN, gemini: async () => Promise.reject(new BackendError(gone, 'unsupported')) } as unknown as MailBackend);
    queryClient.setQueryData(geminiKeys.status, READY);
    const err = await runGemini({ kind: 'search', query: 'when is the lease due?' }).result.catch((e: unknown) => e);
    expect(geminiErrorText(err)).toBe(GEMINI_UNAVAILABLE);
    expect(queryClient.getQueryState(geminiKeys.status)?.isInvalidated).toBe(true);
  });

  it('a source with no Gemini at all (the Gmail API) reads as off, without asking it', async () => {
    setBackend({} as MailBackend);
    expect(await readGeminiStatus()).toEqual(API);
  });

  it('keeps other failures as the source worded them', () => {
    expect(geminiErrorText(new BackendError('Gemini couldn’t answer right now. Try again in a moment.', 'network', true))).toBe('Gemini couldn’t answer right now. Try again in a moment.');
  });
});
