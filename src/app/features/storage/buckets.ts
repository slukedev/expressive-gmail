import type { IconName } from '../../ui/Icon';

export interface Bucket {
  id: string;
  /** Gmail leaves Spam and Trash out unless asked. */
  q: string;
  title: string;
  icon: IconName;
  /** Finishes "Conversations ... move to Trash." */
  confirmWhat: string;
}

/** Gmail's larger:/smaller: count the whole message, attachments included. Ranges don't overlap. */
export const RANGES = [
  { id: 'huge', label: 'Over 10 MB', phrase: 'over 10 MB', q: 'larger:10M' },
  { id: 'big', label: '5 to 10 MB', phrase: 'between 5 and 10 MB', q: 'larger:5M smaller:10M' },
  { id: 'medium', label: '2 to 5 MB', phrase: 'between 2 and 5 MB', q: 'larger:2M smaller:5M' },
] as const;

export const OLD_MAIL: Bucket[] = [
  {
    id: 'promotions',
    q: 'category:promotions older_than:1y -is:starred -is:important',
    title: 'Promotions older than a year',
    icon: 'sell',
    confirmWhat: 'in Promotions from over a year ago',
  },
  {
    id: 'social',
    q: 'category:social older_than:1y -is:starred -is:important',
    title: 'Social notifications older than a year',
    icon: 'group',
    confirmWhat: 'in Social from over a year ago',
  },
  {
    id: 'updates',
    q: 'category:updates older_than:2y -is:starred -is:important',
    title: 'Updates older than two years',
    icon: 'info',
    confirmWhat: 'in Updates from over two years ago',
  },
];

/** With every page read, what's loaded is exact. Otherwise the backend's estimate, as a floor ("200+") when Gmail stopped counting, else what's loaded with a "+". */
export function countLabel(loaded: number, estimate: number | undefined, more: boolean, atLeast = false): string {
  if (!more) return loaded.toLocaleString();
  if (estimate !== undefined && atLeast) return `${Math.max(estimate, loaded).toLocaleString()}+`;
  if (estimate !== undefined && estimate > loaded) return estimate.toLocaleString();
  return `${loaded.toLocaleString()}+`;
}
