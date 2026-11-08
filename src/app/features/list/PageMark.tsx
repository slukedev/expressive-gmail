import { ShapeIcon } from '../../ui/ShapeIcon';
import { viewIdentity } from './viewIdentity';

/** The same family as the list's view marks. */
export function PageMark({ kind }: { kind: 'subscriptions' | 'attachments' | 'reminders' | 'purchases' | 'storage' | 'ai-inbox' }) {
  return <ShapeIcon {...viewIdentity({ kind }, [], false)} size={56} className="page__mark" />;
}
