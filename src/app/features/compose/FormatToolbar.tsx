import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { IconButton, cx } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { MenuGroupLabel, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import { keyLabel } from '../../ui/keys';
import type { EditorHandle } from './Editor';

interface Tool {
  cmd: string;
  icon: IconName;
  label: string;
  shortcut?: string;
  value?: string;
}

const HISTORY: Tool[] = [
  { cmd: 'undo', icon: 'undo', label: 'Undo', shortcut: '⌘Z' },
  { cmd: 'redo', icon: 'redo', label: 'Redo', shortcut: '⌘⇧Z' },
];
const STYLE: Tool[] = [
  { cmd: 'bold', icon: 'format_bold', label: 'Bold', shortcut: '⌘B' },
  { cmd: 'italic', icon: 'format_italic', label: 'Italic', shortcut: '⌘I' },
  { cmd: 'underline', icon: 'format_underlined', label: 'Underline', shortcut: '⌘U' },
];
const LISTS: Tool[] = [
  { cmd: 'insertUnorderedList', icon: 'format_list_bulleted', label: 'Bulleted list', shortcut: '⌘⇧8' },
  { cmd: 'insertOrderedList', icon: 'format_list_numbered', label: 'Numbered list', shortcut: '⌘⇧7' },
];
const BLOCKS: Tool[] = [
  { cmd: 'quote', icon: 'format_quote', label: 'Quote', shortcut: '⌘⇧9' },
  { cmd: 'outdent', icon: 'format_indent_decrease', label: 'Indent less', shortcut: '⌘[' },
  { cmd: 'indent', icon: 'format_indent_increase', label: 'Indent more', shortcut: '⌘]' },
];
const CLEANUP: Tool[] = [
  { cmd: 'strikeThrough', icon: 'format_strikethrough', label: 'Strikethrough', shortcut: '⌘⇧X' },
  { cmd: 'removeFormat', icon: 'format_clear', label: 'Clear formatting', shortcut: '⌘\\' },
];

// Written into the email itself, so plain colors rather than theme roles. Gmail's own picks.
const TEXT_COLORS: [string, string][] = [
  ['Black', '#000000'],
  ['Dark gray', '#444444'],
  ['Gray', '#888888'],
  ['Red', '#cc0000'],
  ['Orange', '#e69138'],
  ['Yellow', '#bf9000'],
  ['Green', '#38761d'],
  ['Teal', '#134f5c'],
  ['Blue', '#0b5394'],
  ['Purple', '#351c75'],
  ['Magenta', '#741b47'],
];
const HIGHLIGHTS: [string, string][] = [
  ['Red', '#f4cccc'],
  ['Orange', '#fce5cd'],
  ['Yellow', '#fff2cc'],
  ['Green', '#d9ead3'],
  ['Teal', '#d0e0e3'],
  ['Blue', '#cfe2f3'],
  ['Purple', '#d9d2e9'],
  ['Magenta', '#ead1dc'],
];
const SIZES: [string, string][] = [
  ['Small', '2'],
  ['Normal', '3'],
  ['Large', '4'],
  ['Huge', '6'],
];

/** Ctrl elsewhere, ⌘ (Meta) on a Mac; both work everywhere. */
export function ariaKeys(shortcut?: string) {
  if (!shortcut) return undefined;
  const rest = shortcut.replace('⌘', '').replace('⇧', 'Shift+');
  return `Control+${rest} Meta+${rest}`;
}

const toolTip = (t: Tool) => (t.shortcut ? `${t.label} (${keyLabel(t.shortcut)})` : t.label);

/** Which toggles are on, size and color. */
function useFormatState(editor: RefObject<EditorHandle | null>) {
  const [state, setState] = useState<{ on: Record<string, boolean>; size: string; color: string }>({ on: {}, size: '', color: '' });
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const root = editor.current?.root();
      const sel = document.getSelection();
      if (!root || !sel?.anchorNode || !root.contains(sel.anchorNode)) return;
      const on: Record<string, boolean> = {};
      for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']) {
        try {
          on[cmd] = document.queryCommandState(cmd);
        } catch {
          on[cmd] = false;
        }
      }
      const start = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
      const quote = start?.closest('blockquote');
      on.quote = !!quote && root.contains(quote);
      const font = start?.closest('font[color]');
      const color = font && root.contains(font) ? (font.getAttribute('color') ?? '') : '';
      let size = '';
      try {
        size = document.queryCommandValue('fontSize');
      } catch {
        size = '';
      }
      setState((s) => (JSON.stringify(s) === JSON.stringify({ on, size, color }) ? s : { on, size, color }));
    };
    // Selection moves fire many times a second while dragging; read once a frame.
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      cancelAnimationFrame(frame);
    };
  }, [editor]);
  return state;
}

/** So the toolbar is one stop on the Tab path. */
function roving(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tool]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
  const step = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + step + items.length) % items.length;
  items.forEach((el, i) => el.setAttribute('tabindex', i === next ? '0' : '-1'));
  items[next]?.focus();
}

/** An M3 Expressive floating toolbar: toggle groups 12px apart, selected ones square off. One Tab stop; arrows move inside. */
export function FormatToolbar({
  editor,
  onLink,
  floating = true,
  open = true,
}: {
  editor: RefObject<EditorHandle | null>;
  /** Compose has its own next to Send. */
  onLink?: () => void;
  floating?: boolean;
  open?: boolean;
}) {
  const { on, size, color } = useFormatState(editor);
  const bar = useRef<HTMLDivElement>(null);
  const exec = (t: Tool) => {
    if (t.cmd === 'quote') editor.current?.exec(on.quote ? 'outdent' : 'formatBlock', on.quote ? undefined : 'blockquote');
    else editor.current?.exec(t.cmd, t.value);
  };
  // The first button holds the Tab stop until arrows move it.
  useEffect(() => {
    const items = bar.current?.querySelectorAll<HTMLElement>('[data-tool]');
    items?.forEach((el, i) => el.setAttribute('tabindex', i === 0 ? '0' : '-1'));
  }, []);

  const button = (t: Tool, toggle = true) => (
    <IconButton
      key={t.cmd}
      data-tool=""
      icon={t.icon}
      label={t.label}
      tooltip={toolTip(t)}
      size="s"
      width="narrow"
      selected={toggle ? !!on[t.cmd] : undefined}
      aria-keyshortcuts={ariaKeys(t.shortcut)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => exec(t)}
    />
  );

  return (
    <div
      ref={bar}
      className={cx('format-toolbar', floating && 'format-toolbar--floating')}
      role="toolbar"
      aria-label="Formatting"
      data-open={open || undefined}
      inert={!open || undefined}
      onKeyDown={roving}
    >
      <div className="format-toolbar__group">{HISTORY.map((t) => button(t, false))}</div>
      <div className="format-toolbar__group">
        <SizeMenu size={size} onPick={(v) => editor.current?.exec('fontSize', v)} />
        {STYLE.map((t) => button(t))}
        <ColorMenu
          color={color}
          onText={(c) => editor.current?.exec('foreColor', c)}
          onHighlight={(c) => editor.current?.exec(document.queryCommandSupported?.('hiliteColor') ? 'hiliteColor' : 'backColor', c)}
          onClear={() => editor.current?.clearColors()}
        />
        {onLink && (
          <IconButton data-tool="" icon="link" label="Insert link" tooltip={`Insert link (${keyLabel('⌘K')})`} size="s" width="narrow" onMouseDown={(e) => e.preventDefault()} onClick={onLink} />
        )}
      </div>
      <div className="format-toolbar__group">{LISTS.map((t) => button(t))}</div>
      <div className="format-toolbar__group">{BLOCKS.map((t) => button(t, t.cmd === 'quote'))}</div>
      <div className="format-toolbar__group">{CLEANUP.map((t) => button(t, t.cmd === 'strikeThrough'))}</div>
    </div>
  );
}

function ToolTrigger({ icon, label, children }: { icon: IconName; label: string; children?: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <BaseMenu.Trigger
        data-tool=""
        className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--narrow format-toolbar__menu"
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
      >
        <Icon name={icon} size={24} />
        {children}
      </BaseMenu.Trigger>
    </Tooltip>
  );
}

function SizeMenu({ size, onPick }: { size: string; onPick: (v: string) => void }) {
  const current = SIZES.find(([, v]) => v === size)?.[1] ?? '3';
  return (
    <BaseMenu.Root>
      <ToolTrigger icon="format_size" label="Text size" />
      <MenuPopup side="top" align="start" className="size-menu">
        <MenuGroupLabel>Text size</MenuGroupLabel>
        <MenuRadioGroup value={current} onValueChange={onPick}>
          {SIZES.map(([name, v]) => (
            <MenuRadioItem key={v} value={v}>
              <span className={`size-menu__sample size-menu__sample--${v}`}>{name}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </BaseMenu.Root>
  );
}

function ColorMenu({ color, onText, onHighlight, onClear }: { color: string; onText: (c: string) => void; onHighlight: (c: string) => void; onClear: () => void }) {
  return (
    <BaseMenu.Root>
      <ToolTrigger icon="format_color_text" label="Text color">
        <span className="format-toolbar__swatch" style={color ? { background: color } : undefined} aria-hidden="true" />
      </ToolTrigger>
      <MenuPopup side="top" align="start" className="color-menu">
        <MenuGroupLabel>Text color</MenuGroupLabel>
        <div className="color-menu__grid" role="group" aria-label="Text color">
          {TEXT_COLORS.map(([name, c]) => (
            <BaseMenu.Item key={c} className="color-menu__swatch" aria-label={`${name} text`} data-current={color.toLowerCase() === c || undefined} style={{ background: c }} onClick={() => onText(c)}>
              {color.toLowerCase() === c && <Icon name="check" size={18} />}
            </BaseMenu.Item>
          ))}
        </div>
        <MenuSeparator />
        <MenuGroupLabel>Highlight</MenuGroupLabel>
        <div className="color-menu__grid" role="group" aria-label="Highlight">
          {HIGHLIGHTS.map(([name, c]) => (
            <BaseMenu.Item key={c} className="color-menu__swatch color-menu__swatch--light" aria-label={`${name} highlight`} style={{ background: c }} onClick={() => onHighlight(c)} />
          ))}
        </div>
        <MenuSeparator />
        <MenuItem icon="format_color_reset" onClick={onClear}>
          Remove color
        </MenuItem>
      </MenuPopup>
    </BaseMenu.Root>
  );
}
