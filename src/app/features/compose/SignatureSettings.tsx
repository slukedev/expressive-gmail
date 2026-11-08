import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../../data/hooks';
import { stripHtml } from '../../lib/format';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Menu, MenuItem } from '../../ui/Menu';
import { Select } from '../../ui/Select';
import { snack } from '../../ui/Snackbar';
import { TextField } from '../../ui/TextField';
import { Editor, type EditorHandle } from './Editor';
import { FormatToolbar } from './FormatToolbar';
import { LinkDialog } from './LinkDialog';
import {
  accountsOf,
  deleteSignature,
  importSignatures,
  loadComposeData,
  newSignatureId,
  saveSignature,
  sendingAddresses,
  signaturePreview,
  setDefault,
  useComposeData,
  type Signature,
  type SignatureUse,
} from './signatures';

const NONE = '';
const clean = (html: string) => html.replace(/\s+/g, ' ').trim();

/** Any number of signatures, written with the compose editor, and which one each address uses for new mail and replies. */
export function SignatureSettings() {
  const { data: account } = useAccount();
  const loaded = useComposeData((s) => s.loaded);
  const signatures = useComposeData((s) => s.signatures);
  const defaults = useComposeData((s) => s.defaults);
  const [editing, setEditing] = useState<Signature | null>(null);
  const [renaming, setRenaming] = useState<Signature | null>(null);

  useEffect(() => {
    void loadComposeData().then(() => importSignatures(account));
  }, [account]);

  const update = useComposeData((s) => s.update);
  const addresses = sendingAddresses(account);
  // A Gmail signature not among yours (deleted here, or changed in Gmail) can come back in one click.
  const fromGmail = accountsOf(account).filter((a) => a.signature?.trim() && !signatures.some((s) => clean(s.html) === clean(a.signature!)));

  if (editing) {
    return (
      <SignatureEditor
        signature={editing}
        taken={signatures.filter((s) => s.id !== editing.id).map((s) => s.name.toLowerCase())}
        onCancel={() => setEditing(null)}
        onSave={(sig) => {
          const isNew = !signatures.some((s) => s.id === sig.id);
          update((d) => {
            let next = saveSignature(d, sig);
            // Your first signature becomes the default wherever there's none yet.
            if (isNew && !d.signatures.length) {
              for (const { address } of addresses) {
                const e = address.email.toLowerCase();
                if (!next.defaults[e]?.new) next = setDefault(next, e, 'new', sig.id);
                if (!next.defaults[e]?.reply) next = setDefault(next, e, 'reply', sig.id);
              }
            }
            return next;
          });
          setEditing(null);
          snack(isNew ? `Signature "${sig.name}" added` : `Signature "${sig.name}" saved`);
        }}
      />
    );
  }

  const remove = (sig: Signature) => {
    const before = useComposeData.getState();
    const snapshot = { signatures: before.signatures, defaults: before.defaults };
    update((d) => deleteSignature(d, sig.id));
    snack(`Signature "${sig.name}" deleted`, { action: { label: 'Undo', onClick: () => update((d) => ({ ...d, ...snapshot })) } });
  };

  const options: [string, string][] = [[NONE, 'No signature'], ...signatures.map((s) => [s.id, s.name] as [string, string])];
  const pick = (email: string, use: SignatureUse) => (id: string) => update((d) => setDefault(d, email, use, id || null));
  const current = (email: string, use: SignatureUse) => {
    const id = defaults[email.toLowerCase()]?.[use];
    return id && signatures.some((s) => s.id === id) ? id : NONE;
  };

  return (
    <div className="settings-group signature-settings">
      <p className="settings-note md-body-medium">
        Your signature goes at the end of what you write, above any quoted mail. While writing, the signature button swaps it for another or takes it out. Signatures are kept in this browser, so Gmail on your phone keeps using the one set in Gmail.
      </p>

      {loaded && signatures.length === 0 && (
        <div className="signature-empty">
          <Icon name="signature" size={24} />
          <span className="md-body-large">No signatures yet</span>
        </div>
      )}
      {signatures.length > 0 && (
        <div className="settings-list" role="list" aria-label="Signatures">
          {signatures.map((s) => (
            <div key={s.id} className="settings-list__item signature-row" role="listitem">
              <Icon name="signature" size={20} />
              <button type="button" className="signature-row__main" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                <span className="md-body-large signature-row__name">{s.name}</span>
                <span className="md-body-medium signature-row__preview">{signaturePreview(s.html) || 'Empty'}</span>
              </button>
              <IconButton icon="edit" label={`Edit ${s.name}`} size="xs" onClick={() => setEditing(s)} />
              <Menu trigger={<IconButton icon="more_vert" label={`More options for ${s.name}`} size="xs" />} align="end">
                <MenuItem icon="edit_note" onClick={() => setRenaming(s)}>
                  Rename
                </MenuItem>
                <MenuItem icon="delete" onClick={() => remove(s)}>
                  Delete
                </MenuItem>
              </Menu>
            </div>
          ))}
        </div>
      )}
      <div className="signature-settings__actions">
        <Button variant="tonal" icon="add" onClick={() => setEditing({ id: newSignatureId(), name: signatures.length ? '' : 'My signature', html: '' })}>
          New signature
        </Button>
        {fromGmail.map((a) => (
          <Button
            key={a.email}
            variant="text"
            icon="download"
            onClick={() => {
              const sig = { id: newSignatureId(), name: fromGmail.length > 1 || accountsOf(account).length > 1 ? a.email : 'Gmail signature', html: a.signature! };
              update((d) => saveSignature(d, sig));
              snack('Gmail signature added');
            }}
          >
            {accountsOf(account).length > 1 ? `Add Gmail signature for ${a.email}` : 'Add your Gmail signature'}
          </Button>
        ))}
      </div>

      {addresses.length > 0 && (
        <>
          <h3 className="md-title-medium signature-settings__heading">Defaults</h3>
          {addresses.map(({ address }) => (
            <div key={address.email} className="signature-defaults">
              <p className="md-label-large signature-defaults__address" title={address.email}>
                {address.name ? `${address.name} <${address.email}>` : address.email}
              </p>
              <div className="setting-row">
                <div className="setting-row__text">
                  <span className="md-body-large">New emails</span>
                </div>
                <div className="setting-row__control">
                  <Select align="end" label={`Signature for new emails from ${address.email}`} value={current(address.email, 'new')} onChange={pick(address.email, 'new')} options={options} />
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-row__text">
                  <span className="md-body-large">Replies and forwards</span>
                </div>
                <div className="setting-row__control">
                  <Select align="end" label={`Signature for replies and forwards from ${address.email}`} value={current(address.email, 'reply')} onChange={pick(address.email, 'reply')} options={options} />
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <RenameDialog
        signature={renaming}
        taken={signatures.filter((s) => s.id !== renaming?.id).map((s) => s.name.toLowerCase())}
        onClose={() => setRenaming(null)}
        onRename={(name) => renaming && update((d) => saveSignature(d, { ...renaming, name }))}
      />
    </div>
  );
}

function SignatureEditor({ signature, taken, onCancel, onSave }: { signature: Signature; taken: string[]; onCancel: () => void; onSave: (s: Signature) => void }) {
  const [name, setName] = useState(signature.name);
  const [html, setHtml] = useState(signature.html);
  const [link, setLink] = useState<{ text: string; href: string; editing: boolean } | null>(null);
  const editor = useRef<EditorHandle>(null);
  const clash = taken.includes(name.trim().toLowerCase());
  const valid = !!name.trim() && !clash && (!!stripHtml(html).trim() || /<img/i.test(html));
  const openLink = () => {
    const at = editor.current?.linkAtSelection();
    setLink(at ? { ...at, editing: true } : { text: editor.current?.getSelectionText() ?? '', href: '', editing: false });
  };
  return (
    <div className="settings-group form-stack signature-edit">
      <TextField
        label="Name"
        value={name}
        autoFocus={!signature.name}
        error={clash ? 'You already have a signature with this name.' : undefined}
        supporting={clash ? undefined : 'Only you see this, in the signature menu.'}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="signature-editor">
        <FormatToolbar editor={editor} floating={false} onLink={openLink} />
        <Editor ref={editor} initialHtml={signature.html} label="Signature" placeholder="Your name, and anything else people should see under it" onChange={setHtml} onLink={openLink} minHeight={140} />
      </div>
      <div className="settings-actions">
        <Button variant="text" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="filled" disabled={!valid} onClick={() => onSave({ ...signature, name: name.trim(), html })}>
          Save signature
        </Button>
      </div>
      <LinkDialog
        open={link !== null}
        initial={link ?? { text: '', href: '', editing: false }}
        onClose={() => {
          setLink(null);
          editor.current?.focus();
        }}
        onApply={(href, text) => editor.current?.setLink(href, text)}
        onRemove={() => editor.current?.removeLink()}
      />
    </div>
  );
}

function RenameDialog({ signature, taken, onClose, onRename }: { signature: Signature | null; taken: string[]; onClose: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (signature) setName(signature.name);
  }, [signature]);
  const clash = taken.includes(name.trim().toLowerCase());
  const valid = !!name.trim() && !clash;
  const save = () => {
    if (!valid) return;
    onRename(name.trim());
    onClose();
  };
  return (
    <Dialog
      open={!!signature}
      onOpenChange={(o) => !o && onClose()}
      title="Rename signature"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="text" disabled={!valid} onClick={save}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField label="Name" value={name} autoFocus error={clash ? 'You already have a signature with this name.' : undefined} onChange={(e) => setName(e.target.value)} />
      </form>
    </Dialog>
  );
}
