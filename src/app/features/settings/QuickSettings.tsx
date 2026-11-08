import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { SEED_PRESETS } from '../../theme/color';
import { updateSettings, useSettings, type Density, type InboxType, type ReadingPane } from '../../state/settings';
import { useUi } from '../../state/ui';
import { Button, IconButton } from '../../ui/Button';
import { ConnectedButtonGroup } from '../../ui/ButtonGroup';
import { Switch } from '../../ui/Switch';
import { classicGmail } from '../../lib/host';
import { Swatch } from '../wallpaper/Swatch';
import { applyPictureColors, usePictureChoice } from '../wallpaper/colors';
import { CustomSwatch, RandomSwatch } from './ColorChoices';
import { openAllSettings } from './lazy';
import { UiScaleSlider } from './UiScaleChoice';
import { useUiScaleAvailable } from '../../theme/uiScale';

function Radio<T extends string>({ name, value, current, onChange, children }: { name: string; value: T; current: T; onChange: (v: T) => void; children: React.ReactNode }) {
  return (
    <label className="radio-row">
      <input type="radio" name={name} checked={value === current} onChange={() => onChange(value)} className="m3-radio" />
      <span className="md-body-large">{children}</span>
    </label>
  );
}

export function QuickSettings() {
  const open = useUi((s) => s.quickSettings);
  const s = useSettings((x) => x);
  const picture = usePictureChoice();
  const scalable = useUiScaleAvailable();
  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => useUi.getState().set({ quickSettings: o })}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="m3-scrim m3-scrim--light" />
        <BaseDialog.Popup className="side-sheet" aria-label="Quick settings">
          <header className="side-sheet__head">
            <BaseDialog.Title className="md-title-large side-sheet__title">Quick settings</BaseDialog.Title>
            <BaseDialog.Close render={<IconButton icon="close" label="Close" />} />
          </header>
          <div className="side-sheet__body">
            <Button
              variant="tonal"
              className="side-sheet__all"
              onClick={() => void openAllSettings()}
            >
              See all settings
            </Button>

            <section className="qs-section">
              <h3 className="md-title-small qs-title">Theme</h3>
              <ConnectedButtonGroup
                label="Theme"
                value={s.themeMode}
                onChange={(themeMode) => updateSettings({ themeMode })}
                options={[
                  { value: 'light', label: 'Light', icon: 'light_mode' },
                  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
                  { value: 'system', label: 'System', icon: 'brightness_auto' },
                ]}
              />
              <div className="swatches-wallpaper" role="group" aria-label="Colors">
                {picture && (
                  <Swatch
                    seed={picture.seed}
                    label="From your picture"
                    selected={picture.selected}
                    photo={picture.url ? { url: picture.url, colors: picture.colors } : undefined}
                    onClick={() => void applyPictureColors()}
                  />
                )}
                <Swatch seed="#0b57d0" google label="Google" selected={s.themeSource === 'google'} onClick={() => updateSettings({ themeSource: 'google' })} />
                {SEED_PRESETS.map((p) => (
                  <Swatch
                    key={p.seed}
                    seed={p.seed}
                    label={p.name}
                    selected={s.themeSource === 'dynamic' && s.seed === p.seed}
                    onClick={() => updateSettings({ themeSource: 'dynamic', seed: p.seed })}
                  />
                ))}
                <RandomSwatch />
                <CustomSwatch />
              </div>
            </section>

            {scalable && (
              <section className="qs-section">
                <UiScaleSlider title="Interface size" />
              </section>
            )}

            <section className="qs-section">
              <h3 className="md-title-small qs-title">Density</h3>
              {(
                [
                  ['default', 'Default'],
                  ['comfortable', 'Comfortable'],
                  ['compact', 'Compact'],
                ] as [Density, string][]
              ).map(([v, l]) => (
                <Radio key={v} name="density" value={v} current={s.density} onChange={(density) => updateSettings({ density })}>
                  {l}
                </Radio>
              ))}
            </section>

            <section className="qs-section">
              <label className="switch-row">
                <span className="qs-switch-text">
                  <span className="md-body-large">Label tags in the list</span>
                </span>
                <Switch checked={s.showLabelChips} onCheckedChange={(showLabelChips) => updateSettings({ showLabelChips })} label="Label tags in the list" />
              </label>
              <label className="switch-row">
                <span className="qs-switch-text">
                  <span className="md-body-large">Smart chips and cards</span>
                  <span className="md-body-small qs-switch-desc">Codes, packages, invites, bills and deals</span>
                </span>
                <Switch checked={s.smartFeatures} onCheckedChange={(smartFeatures) => updateSettings({ smartFeatures })} label="Smart chips and cards" />
              </label>
            </section>

            <section className="qs-section">
              <h3 className="md-title-small qs-title">Inbox type</h3>
              {(
                [
                  ['categories', 'Default, with category tabs'],
                  ['everything', 'Everything in one list'],
                  ['important-first', 'Important first'],
                  ['unread-first', 'Unread first'],
                  ['starred-first', 'Starred first'],
                ] as [InboxType, string][]
              ).map(([v, l]) => (
                <Radio key={v} name="inbox" value={v} current={s.inboxType} onChange={(inboxType) => updateSettings({ inboxType })}>
                  {l}
                </Radio>
              ))}
            </section>

            <section className="qs-section">
              <h3 className="md-title-small qs-title">Reading pane</h3>
              {(
                [
                  ['auto', 'Automatic, when there’s room'],
                  ['right', 'Right of inbox'],
                  ['none', 'No split'],
                ] as [ReadingPane, string][]
              ).map(([v, l]) => (
                <Radio key={v} name="pane" value={v} current={s.readingPane} onChange={(readingPane) => updateSettings({ readingPane })}>
                  {l}
                </Radio>
              ))}
            </section>

            <section className="qs-section">
              <label className="switch-row">
                <span className="md-body-large">Sender images</span>
                <Switch checked={s.showAvatars} onCheckedChange={(showAvatars) => updateSettings({ showAvatars })} label="Sender images" />
              </label>
              <label className="switch-row">
                <span className="md-body-large">Message previews</span>
                <Switch checked={s.showSnippets} onCheckedChange={(showSnippets) => updateSettings({ showSnippets })} label="Message previews" />
              </label>
            </section>

            <Button variant="text" icon="swap_horiz" onClick={() => classicGmail()}>
              Switch to classic Gmail
            </Button>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
