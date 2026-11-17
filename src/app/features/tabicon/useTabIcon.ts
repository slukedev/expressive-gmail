import { useEffect, useMemo, useState } from 'react';
import { accountShortLabel, scopeName, useAccounts } from '../../data/accounts/store';
import { hostGmailIcon, setHostFavicon } from '../../lib/host';
import { useSettings } from '../../state/settings';
import { labelDotColor } from '../../theme/color';
import { useResolvedDark, useThemeVars } from '../../theme/ThemeProvider';
import { isPhone } from '../../../shared/mobile';
import { initialOf, needsDrawing, tabIconFor, type TabIcon } from './choice';
import { renderTabIcon, type TabIconColors } from './render';

/** Phones show no tab icons; nothing is drawn there. */
export const tabIconsShown = () => typeof navigator !== 'undefined' && !isPhone(navigator.userAgent);

export function tabIconColors(color: TabIcon['color'], vars: Record<string, string>, dark: boolean): TabIconColors {
  const badge = { badge: vars['--md-sys-color-error']!, onBadge: vars['--md-sys-color-on-error']! };
  if (color === 'theme') return { tile: vars['--md-sys-color-primary']!, onTile: vars['--md-sys-color-on-primary']!, ...badge };
  // The hue as account badges and dots show it.
  return { tile: labelDotColor(color, dark), onTile: vars['--md-sys-color-surface-container-lowest']!, ...badge };
}

export function useTabIconColors(color: TabIcon['color']): TabIconColors {
  const vars = useThemeVars();
  const dark = useResolvedDark();
  return useMemo(() => tabIconColors(color, vars, dark), [color, vars, dark]);
}

/** The account a tab shows, or null in All inboxes and circles. */
export function useShownAccount(): string | null {
  return useAccounts((s) => (s.scope?.startsWith('account:') ? s.scope.slice('account:'.length) || null : null));
}

/** The name a letter icon takes its initial from: the account's short name (nickname, work domain, address), else the merged scope's. */
export function useScopeInitial(email: string | null): string {
  const accountPrefs = useSettings((s) => s.accountPrefs);
  const circles = useSettings((s) => s.circles);
  return useAccounts((s) => {
    if (email) {
      const account = s.accounts.find((a) => a.email.toLowerCase() === email);
      return initialOf(account ? accountShortLabel(account, s.accounts, { accountPrefs }) : email);
    }
    return s.scope ? initialOf(scopeName(s.scope, s.accounts, { circles, accountPrefs })) : '';
  });
}

/** Gmail's own icon as an image to draw a count on: undefined while it loads, null when it can't be had. */
export function useGmailIconImage(wanted: boolean): HTMLImageElement | null | undefined {
  const [image, setImage] = useState<HTMLImageElement | null | undefined>(undefined);
  useEffect(() => {
    if (!wanted || image) return;
    let live = true;
    void hostGmailIcon().then((href) => {
      if (!live) return;
      if (!href) return setImage(null);
      const img = new Image();
      img.onload = () => live && setImage(img);
      img.onerror = () => live && setImage(null);
      img.src = href;
    });
    return () => {
      live = false;
    };
  }, [wanted, image]);
  return image;
}

/** Keeps the tab's icon to the setting for the account on screen, with the inbox's unread count. */
export function useTabIcon(unread: number) {
  const email = useShownAccount();
  const icon = useSettings((s) => tabIconFor(s, email));
  const initial = useScopeInitial(email);
  const colors = useTabIconColors(icon.color);
  const drawn = needsDrawing(icon, unread);
  const gmailImage = useGmailIconImage(drawn && icon.look === 'gmail');
  useEffect(() => {
    if (!tabIconsShown()) return;
    if (!drawn) return setHostFavicon(null);
    const count = icon.count ? unread : null;
    if (icon.look !== 'gmail') return setHostFavicon(renderTabIcon({ look: icon.look, colors, unread: count, initial }));
    // Gmail's icon couldn't be read (offline, say): Gmail's own, without the count, beats a guess.
    if (gmailImage === null) return setHostFavicon(null);
    if (gmailImage) setHostFavicon(renderTabIcon({ look: 'image', colors, unread: count }, gmailImage));
  }, [drawn, icon, unread, colors, initial, gmailImage]);
}
