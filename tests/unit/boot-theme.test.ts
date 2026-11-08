import { describe, expect, it } from 'vitest';
import { pickBootTheme, pickFrameBg, systemDarkFromSearch } from '../../src/shared/boot-theme';

const dark = { '--md-sys-color-surface-container': '#211a1d', '--md-sys-color-primary': '#ffb0c8' };
const light = { '--md-sys-color-surface-container': '#f8eaed', '--md-sys-color-primary': '#8c4a60' };

describe('pickBootTheme', () => {
  it('falls back to the default Google theme for the system scheme', () => {
    expect(pickBootTheme(null, true)).toMatchObject({ dark: true, source: 'google' });
    expect(pickBootTheme(null, true).vars['--md-sys-color-surface-container']).toBe('#1e1f20');
    expect(pickBootTheme('not json', false).vars['--md-sys-color-surface-container']).toBe('#f0f4f9');
  });

  it('follows the system scheme in System mode', () => {
    const raw = JSON.stringify({ mode: 'system', source: 'dynamic', light, dark });
    expect(pickBootTheme(raw, true)).toEqual({ dark: true, source: 'dynamic', vars: dark });
    expect(pickBootTheme(raw, false)).toEqual({ dark: false, source: 'dynamic', vars: light });
  });

  it('keeps a forced scheme whatever the system says', () => {
    expect(pickBootTheme(JSON.stringify({ mode: 'dark', source: 'dynamic', dark }), false)).toEqual({ dark: true, source: 'dynamic', vars: dark });
    expect(pickBootTheme(JSON.stringify({ mode: 'light', source: 'google', light }), true).dark).toBe(false);
  });

  it('drops anything that is not a color role', () => {
    const raw = JSON.stringify({ mode: 'dark', source: 'dynamic', dark: { ...dark, '--other': '#000', '--md-sys-color-x': 'url(evil)' } });
    expect(pickBootTheme(raw, false).vars).toEqual(dark);
  });
});

describe('pickFrameBg', () => {
  it('uses the system scheme with nothing saved', () => {
    expect(pickFrameBg(null, true)).toEqual({ background: '#1e1f20', dark: true });
    expect(pickFrameBg(null, false)).toEqual({ background: '#f0f4f9', dark: false });
  });

  it('picks the saved color for the system scheme in System mode', () => {
    const raw = JSON.stringify({ system: true, light: '#f8eaed', dark: '#211a1d', background: '#f8eaed' });
    expect(pickFrameBg(raw, true)).toEqual({ background: '#211a1d', dark: true });
  });

  it('keeps a forced scheme, inferring it from the color when an older save lacks it', () => {
    expect(pickFrameBg(JSON.stringify({ background: '#211a1d', isDark: true }), false)).toEqual({ background: '#211a1d', dark: true });
    expect(pickFrameBg(JSON.stringify({ background: '#1e1f20' }), false)).toEqual({ background: '#1e1f20', dark: true });
    expect(pickFrameBg('#f0f4f9', true)).toEqual({ background: '#f0f4f9', dark: false });
  });

  it('ignores a value that is not a color', () => {
    expect(pickFrameBg(JSON.stringify({ background: 'red;}body{x' }), true).background).toBe('#1e1f20');
  });
});

describe('systemDarkFromSearch', () => {
  it('reads the flag the content script passes', () => {
    expect(systemDarkFromSearch('?dark=1')).toBe(true);
    expect(systemDarkFromSearch('?dark=0')).toBe(false);
    expect(systemDarkFromSearch('')).toBeUndefined();
  });
});
