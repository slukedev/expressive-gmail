import { useEffect } from 'react';
import { onAppLaunch, setAppBadge, type AppLaunch } from '../../lib/appHost';
import { useSettings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { badgeFor, sharedText } from '../../../shared/pwa';
import { composeFromMailto, composeShared, newCompose } from '../compose/open';

function open(launch: AppLaunch) {
  // Whatever was open over the mail steps aside for what the launch asked for.
  useUi.getState().set({ settingsSection: null, palette: false, quickSettings: false });
  switch (launch.kind) {
    case 'compose':
      newCompose();
      break;
    case 'mailto':
      composeFromMailto(launch.href);
      break;
    case 'share':
      composeShared({ subject: launch.title, text: sharedText(launch) });
      break;
    case 'files':
      if (launch.files?.length) composeShared({ files: launch.files });
      break;
    case 'route':
      if (location.hash !== launch.hash) location.hash = launch.hash;
      break;
  }
}

/** The installed app's launches (shortcuts, email links, shares, files) and its icon badge. */
export function useAppLaunches(inboxUnread: number) {
  useEffect(() => onAppLaunch(open), []);
  const mode = useSettings((s) => s.appBadge);
  useEffect(() => setAppBadge(badgeFor(inboxUnread, mode)), [inboxUnread, mode]);
}
