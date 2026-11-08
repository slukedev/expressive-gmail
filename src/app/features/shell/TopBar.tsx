import { useMemo } from 'react';
import { IconButton } from '../../ui/Button';
import { useUi } from '../../state/ui';
import { SearchBar } from '../search/SearchBar';
import { AccountMenu } from './AccountMenu';
import { BrandMark } from './BrandMark';
import { SupportMenu } from './SupportMenu';
import { openHome } from '../../router/useRoute';
import { useSettings } from '../../state/settings';
import { GeminiButton } from '../gemini/GeminiButton';

/** A link back to the inbox, or All mail when Gmail starts there. */
export function Brand() {
  const start = useSettings((s) => s.startView);
  return (
    <a
      className="topbar__brand"
      // Moves between the rail header and the top bar as the rail collapses.
      data-morph="brand"
      href={`#${start}`}
      onClick={(e) => {
        e.preventDefault();
        openHome();
      }}
      aria-label={start === 'all' ? 'Gmail, All mail' : 'Gmail inbox'}
    >
      <BrandMark size={36} />
      <span className="topbar__wordmark">Gmail</span>
    </a>
  );
}

/** Search, then help, settings and account. The brand moves here only while the rail is collapsed. */
export function TopBar({ compact, brand, onMenu }: { compact: boolean; brand: boolean; onMenu: () => void }) {
  // The rail toggle re-renders the bar for the brand; search and the actions sit that commit out.
  const search = useMemo(() => <SearchBar compact={compact} />, [compact]);
  const end = useMemo(
    () => (
      <div className="topbar__end">
        <GeminiButton />
        {!compact && (
          <>
            <SupportMenu />
            <IconButton icon="settings" label="Settings" onClick={() => useUi.getState().set({ quickSettings: true })} />
          </>
        )}
        <AccountMenu />
      </div>
    ),
    [compact],
  );
  return (
    <header className="topbar">
      {(compact || brand) && (
        <div className="topbar__start">
          {compact ? <IconButton icon="menu" label="Main menu" onClick={onMenu} size="s" /> : <Brand />}
        </div>
      )}
      <div className="topbar__search" data-morph="search">
        {search}
      </div>
      {end}
    </header>
  );
}
