import { Popover } from '@base-ui/react/popover';
import type { ReactElement } from 'react';
import type { Address } from '../data/types';
import { navigate } from '../router/useRoute';
import { useLocal } from '../state/local';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { newCompose } from '../features/compose/open';
import { useCopy } from '../ui/feedback';

/** Gmail's sender card, on hover or click. */
export function SenderCard({ person, children }: { person: Address; children: ReactElement<Record<string, unknown>> }) {
  const blocked = useLocal((s) => s.blocked.includes(person.email.toLowerCase()));
  const { copied, copy } = useCopy();
  return (
    <Popover.Root>
      <Popover.Trigger render={children} nativeButton={false} openOnHover delay={450} closeDelay={150} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} className="m3-menu-positioner">
          <Popover.Popup className="sender-card">
            <div className="sender-card__who">
              <Avatar name={person.name} email={person.email} size={56} />
              <div className="sender-card__names">
                <span className="md-title-large">{person.name ?? person.email}</span>
                {person.name && <span className="md-body-medium sender-card__email">{person.email}</span>}
                {blocked && <span className="md-label-medium sender-card__blocked">Blocked</span>}
              </div>
            </div>
            <div className="sender-card__actions">
              <Button variant="tonal" size="xs" icon="edit" onClick={() => newCompose({ to: [person] })}>
                Email
              </Button>
              <Button
                variant="text"
                size="xs"
                icon="content_copy"
                confirmed={copied}
                confirmedLabel="Copied"
                onClick={() => void copy(person.email, 'Email address copied')}
              >
                Copy
              </Button>
              <Button variant="text" size="xs" icon="search" onClick={() => navigate({ view: { kind: 'search', query: `from:${person.email}` } })}>
                Emails
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
