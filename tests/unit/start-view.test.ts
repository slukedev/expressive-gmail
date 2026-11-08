import { applyStartView, openHome } from '../../src/app/router/useRoute';
import { DEFAULT_SETTINGS, useSettingsStore } from '../../src/app/state/settings';

function start(startView: 'inbox' | 'all', hash: string) {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, startView } });
  history.replaceState(null, '', hash || location.pathname);
  applyStartView();
  return location.hash;
}

describe('start view', () => {
  beforeEach(() => sessionStorage.clear());

  it('opens a new tab on All mail when that is the setting', () => {
    expect(start('all', '#inbox')).toBe('#all');
  });

  it('opens a new tab with no hash on All mail', () => {
    expect(start('all', '')).toBe('#all');
  });

  it('leaves the inbox alone by default', () => {
    expect(start('inbox', '#inbox')).toBe('#inbox');
  });

  it('keeps links to a thread, another view or settings', () => {
    expect(start('all', '#inbox/t-1')).toBe('#inbox/t-1');
    sessionStorage.clear();
    expect(start('all', '#starred')).toBe('#starred');
    sessionStorage.clear();
    expect(start('all', '#settings/inbox')).toBe('#settings/inbox');
  });

  it('keeps the inbox when the tab reloads there', () => {
    start('all', '#inbox');
    expect(start('all', '#inbox')).toBe('#inbox');
  });

  it('sends the logo to the start view', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, startView: 'all' } });
    history.replaceState(null, '', '#starred');
    openHome();
    expect(location.hash).toBe('#all');
  });
});
