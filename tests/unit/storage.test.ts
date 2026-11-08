import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readKey } from '../../src/app/state/storage';
import { loadLocal, local, useLocal } from '../../src/app/state/local';
import { updateSettings, useSettingsStore } from '../../src/app/state/settings';

afterEach(() => vi.restoreAllMocks());

/** Rejections nobody handled while `fn` and what it started ran. */
async function unhandled(fn: () => void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => seen.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    fn();
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return seen;
}

describe('extension storage failures', () => {
  beforeEach(() => fakeBrowser.reset());

  it('a read from an invalidated extension context reads as nothing, not a rejection', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('Extension context invalidated.'));
    await expect(readKey('bg.settings.v1')).resolves.toBeUndefined();
  });

  it('a write over quota keeps what changed in memory and leaves no unhandled rejection', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
    const errors = await unhandled(() => {
      local.togglePin('thread-f:9');
      updateSettings({ density: 'compact' });
    });
    expect(errors).toEqual([]);
    expect(useLocal.getState().pinned).toContain('thread-f:9');
    expect(useSettingsStore.getState().settings.density).toBe('compact');
  });
});

describe('local data read back from storage', () => {
  beforeEach(() => fakeBrowser.reset());

  it('fields of the wrong type fall back to empty, so actions on them still work', async () => {
    await fakeBrowser.storage.local.set({ 'bg.local.v1': { pinned: null, notes: 'x', reminders: {}, blocked: ['a@example.com'] } });
    await loadLocal();
    const s = useLocal.getState();
    expect(s.pinned).toEqual([]);
    expect(s.notes).toEqual({});
    expect(s.reminders).toEqual([]);
    expect(s.blocked).toEqual(['a@example.com']);
    expect(() => local.togglePin('thread-f:1')).not.toThrow();
    expect(useLocal.getState().pinned).toEqual(['thread-f:1']);
  });

  it('Looks safe on a phishing warning is kept, in every inbox the message shows in', async () => {
    await loadLocal();
    local.markSafe('abc1234~msg-f:9');
    expect((await readKey<{ safeMessages: string[] }>('bg.local.v1'))?.safeMessages).toEqual(['msg-f:9']);
    await loadLocal();
    expect(useLocal.getState().safeMessages).toEqual(['msg-f:9']);
  });

  it('a stored value that is not an object at all is ignored', async () => {
    await fakeBrowser.storage.local.set({ 'bg.local.v1': 'broken' });
    await loadLocal();
    expect(useLocal.getState().pinned).toEqual([]);
    expect(Object.keys(useLocal.getState())).not.toContain('0');
  });
});

describe('settings read back from storage', () => {
  beforeEach(() => fakeBrowser.reset());

  it('a field of the wrong type takes its default, the rest is kept', async () => {
    const { loadSettings, DEFAULT_SETTINGS } = await import('../../src/app/state/settings');
    await fakeBrowser.storage.local.set({ 'bg.settings.v1': { splits: null, categories: 'x', pageSize: 25, inboxPause: { since: 1, until: null } } });
    await loadSettings();
    const s = useSettingsStore.getState().settings;
    expect(s.splits).toEqual(DEFAULT_SETTINGS.splits);
    expect(s.categories).toEqual(DEFAULT_SETTINGS.categories);
    expect(s.pageSize).toBe(25);
    expect(s.inboxPause).toEqual({ since: 1, until: null });
  });

  it('a built-in picture from an older version becomes no picture, keeping the colours in use', async () => {
    const { loadSettings } = await import('../../src/app/state/settings');
    await fakeBrowser.storage.local.set({ 'bg.settings.v1': { wallpaper: 'builtin:bloom', wallpaperColors: ['#aa3355'], themeSource: 'dynamic', seed: '#aa3355' } });
    await loadSettings();
    const s = useSettingsStore.getState().settings;
    expect(s.wallpaper).toBe('');
    expect(s.wallpaperColors).toEqual([]);
    expect(s.seed).toBe('#aa3355');
    // With the picture gone, its colour stays one tap away as your own.
    expect(s.customSeed).toBe('#aa3355');
  });

  it('a colour picked before there was a custom swatch becomes yours; presets, picture colours and junk do not', async () => {
    const { loadSettings } = await import('../../src/app/state/settings');
    const customFrom = async (stored: object) => {
      await fakeBrowser.storage.local.set({ 'bg.settings.v1': stored });
      await loadSettings();
      return useSettingsStore.getState().settings.customSeed;
    };
    expect(await customFrom({ themeSource: 'dynamic', seed: '#4A5C70' })).toBe('#4a5c70');
    expect(await customFrom({ themeSource: 'dynamic', seed: '#006a6a' })).toBe('');
    expect(await customFrom({ themeSource: 'dynamic', seed: '#aa3355', wallpaper: 'custom:abc', wallpaperColors: ['#aa3355'] })).toBe('');
    // Once saved, your colour is what you left it as, even nothing.
    expect(await customFrom({ themeSource: 'dynamic', seed: '#4a5c70', customSeed: '' })).toBe('');
    expect(await customFrom({ customSeed: 'red; }' })).toBe('');
  });

  it('a random theme rolls on every load to the colour saved for it, and saves the one after', async () => {
    const { loadSettings } = await import('../../src/app/state/settings');
    await fakeBrowser.storage.local.set({ 'bg.settings.v1': { themeSource: 'dynamic', seed: '#00639b', randomSeed: '#00639b', nextRandomSeed: '#8b5000' } });
    await loadSettings();
    const s = useSettingsStore.getState().settings;
    expect([s.seed, s.randomSeed]).toEqual(['#8b5000', '#8b5000']);
    expect(s.nextRandomSeed).toMatch(/^#[0-9a-f]{6}$/);
    expect(s.nextRandomSeed).not.toBe('#8b5000');
    expect(await readKey('bg.settings.v1')).toMatchObject({ seed: '#8b5000', nextRandomSeed: s.nextRandomSeed });

    // Any other theme stays put, a once-random colour picked away from included.
    await fakeBrowser.storage.local.set({ 'bg.settings.v1': { themeSource: 'dynamic', seed: '#006a6a', randomSeed: '#00639b', nextRandomSeed: '#8b5000' } });
    await loadSettings();
    expect(useSettingsStore.getState().settings.seed).toBe('#006a6a');
  });

  it('your own picture is kept', async () => {
    const { loadSettings } = await import('../../src/app/state/settings');
    await fakeBrowser.storage.local.set({ 'bg.settings.v1': { wallpaper: 'custom:abc', wallpaperColors: ['#aa3355'] } });
    await loadSettings();
    expect(useSettingsStore.getState().settings.wallpaper).toBe('custom:abc');
  });
});
