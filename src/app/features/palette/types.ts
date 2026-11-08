import type { Address } from '../../data/types';
import type { IconName } from '../../ui/Icon';

/** Drill-in lists, like Raycast's pushed views. */
export type PageId =
  | 'snooze'
  | 'remind'
  | 'label'
  | 'unlabel'
  | 'move'
  | 'write'
  | 'person'
  | 'pause'
  | 'go'
  | 'switch'
  | 'template'
  | 'setting'
  | 'help'
  | `choice:${string}`;

export interface PageRef {
  id: PageId;
  /** Shown in the chip in the field. */
  title: string;
  /** Person page only. */
  person?: Address;
}

/** What Enter does after running: close the palette, or stay (a switch flipping in place). */
export type After = 'close' | 'stay';

export interface Item {
  /** For ranking by use and repeating. Page items prefix their page ("snooze:tomorrow"). */
  id: string;
  title: string;
  group: string;
  icon?: IconName;
  /** Tint for a label icon. */
  iconColor?: string;
  avatar?: Address;
  meta?: string;
  /** Plain text, trailing. */
  shortcut?: string;
  keywords?: string;
  page?: PageRef;
  run?: () => After | void;
  /** Cmd/Ctrl+Enter. */
  alt?: { label: string; run: () => void };
  /** Drawn as a switch. */
  toggle?: boolean;
  /** Drawn with a check. */
  current?: boolean;
  chips?: string[];
  /** Visible but does nothing ("That time has passed"). */
  disabled?: boolean;
  /** Not remembered for ranking or repeat. */
  ephemeral?: boolean;
  /** The open conversation's own actions lead an equal match elsewhere. */
  boost?: number;
  /** A parsed "snooze fri" preview. */
  pinned?: boolean;
  /** So Repeat can find it again. */
  origin?: { page: PageRef; query: string };
}
