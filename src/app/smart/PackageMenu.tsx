import { IconButton } from '../ui/Button';
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Submenu } from '../ui/Menu';
import { snack } from '../ui/Snackbar';
import { packageLabel, type PackageInfo, type PackageStatus } from './extract';
import type { TrackingRecord } from './tracking';
import { stopTrackingEmail } from './TrackOrderMenu';
import { restoreRecord, setPackageStatus, trackedByHand } from './trackingStore';

const STATUSES: PackageStatus[] = ['ordered', 'shipped', 'out-for-delivery', 'delivered', 'problem'];

export interface PackageMenuProps {
  pkgKey?: string;
  record?: TrackingRecord;
  status: PackageStatus;
  /** So a package with no record yet can get one. */
  seed: { threadId: string; info: Pick<PackageInfo, 'status' | 'merchant' | 'carrier' | 'trackUrl' | 'tracking' | 'orderNo'>; at: number };
}

/** Mark as delivered first, the rest under Change status. A hand-set status holds until a newer email moves it on. */
export function PackageMenu({ pkgKey, record, status, seed }: PackageMenuProps) {
  const set = (next: PackageStatus | null, message: string) => {
    const { key, before } = setPackageStatus(pkgKey ?? record?.key, next, seed);
    snack(message, { action: { label: 'Undo', onClick: () => restoreRecord(key, before) } });
  };
  const byHand = trackedByHand(record, seed.threadId);
  return (
    <Menu trigger={<IconButton icon="more_vert" label="Package options" size="xs" />} align="end">
      {status !== 'delivered' && (
        <MenuItem icon="inventory_2" onClick={() => set('delivered', 'Marked as delivered')}>
          Mark as delivered
        </MenuItem>
      )}
      <Submenu icon="edit" label="Change status">
        <MenuRadioGroup value={status} onValueChange={(v) => v !== status && set(v as PackageStatus, `Marked as ${packageLabel(v as PackageStatus).toLowerCase()}`)}>
          {STATUSES.map((s) => (
            <MenuRadioItem key={s} value={s}>
              {packageLabel(s)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </Submenu>
      {record?.manual && (
        <MenuItem icon="history" onClick={() => set(null, 'Showing the status from your emails')}>
          Use status from emails
        </MenuItem>
      )}
      {byHand && <MenuSeparator />}
      {byHand && (
        <MenuItem icon="close" onClick={() => stopTrackingEmail(seed.threadId)}>
          Remove from Packages
        </MenuItem>
      )}
    </Menu>
  );
}
