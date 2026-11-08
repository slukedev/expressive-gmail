import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useState, type RefObject } from 'react';
import { useUi } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import type { EditorHandle } from './Editor';
import { signatureIn } from './signatureDom';
import { signaturePreview, useComposeData, type Signature } from './signatures';

const NONE = 'none';
const OTHER = 'other';

/** Shared by the button and the narrow More menu. A plain function so its separator starts a new menu section. */
export function signatureChoices({ editor, current, signatures, onPicked }: { editor: RefObject<EditorHandle | null>; current: string; signatures: Signature[]; onPicked?: () => void }) {
  const pick = (value: string) => {
    if (value === OTHER) return;
    const sig = signatures.find((s) => s.id === value);
    editor.current?.setSignature(sig ? sig.html : null);
    onPicked?.();
  };
  return (
    <>
      <MenuGroupLabel>Signature</MenuGroupLabel>
      <MenuRadioGroup value={current} onValueChange={pick}>
        <MenuRadioItem value={NONE}>No signature</MenuRadioItem>
        {signatures.map((s) => (
          <MenuRadioItem key={s.id} value={s.id}>
            <span className="signature-choice">
              <span>{s.name}</span>
              <span className="signature-choice__preview">{preview(s)}</span>
            </span>
          </MenuRadioItem>
        ))}
        {current === OTHER && <MenuRadioItem value={OTHER}>Edited in this message</MenuRadioItem>}
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuItem icon="edit" onClick={() => useUi.getState().set({ settingsSection: 'signatures' })}>
        Manage signatures
      </MenuItem>
    </>
  );
}

function preview(s: Signature) {
  return signaturePreview(s.html).slice(0, 60);
}

export function currentSignatureChoice(editor: RefObject<EditorHandle | null>, signatures: Signature[]) {
  const root = editor.current?.root();
  if (!root) return NONE;
  const id = signatureIn(root, signatures);
  return id === null ? NONE : (id ?? OTHER);
}

/** Swaps the signature in place, leaving what you wrote alone. */
export function SignatureMenu({ editor }: { editor: RefObject<EditorHandle | null> }) {
  const signatures = useComposeData((s) => s.signatures);
  const [current, setCurrent] = useState(NONE);
  return (
    <BaseMenu.Root onOpenChange={(o) => o && setCurrent(currentSignatureChoice(editor, signatures))}>
      <Tooltip content="Signature">
        <BaseMenu.Trigger className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default" aria-label="Signature">
          <Icon name="signature" size={24} />
        </BaseMenu.Trigger>
      </Tooltip>
      <MenuPopup side="top" align="start" className="signature-menu">
        {signatureChoices({ editor, current, signatures })}
      </MenuPopup>
    </BaseMenu.Root>
  );
}
