import { useEffect, useRef } from 'react';
import { useAccount } from '../../data/hooks';
import { type ComposeDraft } from '../../state/ui';
import { useUi } from '../../state/ui';
import { Avatar } from '../../ui/Avatar';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../ui/Menu';
import { ComposeForm } from './ComposeForm';
import { switchMode } from './open';
import { SaveStatus } from './SaveStatus';
import { saveAndClose } from './status';

const MODES = { reply: { icon: 'reply', label: 'Reply' }, 'reply-all': { icon: 'reply_all', label: 'Reply all' }, forward: { icon: 'forward', label: 'Forward' }, new: { icon: 'edit', label: 'New' } } as const;

/** Gmail web's inline reply card at the end of a thread. */
export function InlineCompose({ draft }: { draft: ComposeDraft }) {
  const { data: account } = useAccount();
  const ref = useRef<HTMLDivElement>(null);
  // What opened the reply (its Reply button, or the conversation for "r") gets focus back when it closes.
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [draft.key]);
  const close = () => {
    const back = opener.current;
    void saveAndClose(draft);
    requestAnimationFrame(() => {
      const target = back instanceof HTMLElement && back.isConnected && back !== document.body ? back : document.querySelector<HTMLElement>('.detail-pane .thread-scroll');
      target?.focus({ preventScroll: true });
    });
  };
  const mode = MODES[draft.mode];
  return (
    <div className="inline-compose" ref={ref}>
      <Avatar name={account?.name} email={account?.email ?? 'me'} photoUrl={account?.photoUrl} size={40} className="inline-compose__avatar" />
      <div className="inline-compose__card">
        <div className="inline-compose__head">
          <Menu
            trigger={
              <button type="button" className="inline-compose__mode" aria-label={`Type of response: ${mode.label}`}>
                <Icon name={mode.icon} size={20} />
                <Icon name="arrow_drop_down" size={18} />
              </button>
            }
          >
            <MenuRadioGroup value={draft.mode} onValueChange={(m) => switchMode(draft.key, m as 'reply' | 'reply-all' | 'forward')}>
              {(['reply', 'reply-all', 'forward'] as const).map((m) => (
                <MenuRadioItem key={m} value={m} icon={MODES[m].icon}>
                  {MODES[m].label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </Menu>
          <span className="inline-compose__to md-title-small">{mode.label}</span>
          <SaveStatus draftKey={draft.key} />
          <IconButton icon="open_in_new" label="Pop out reply" size="xs" onClick={() => useUi.getState().updateCompose(draft.key, { inline: false, window: 'open' })} />
        </div>
        <ComposeForm draft={draft} variant="inline" onEscape={close} />
      </div>
    </div>
  );
}
