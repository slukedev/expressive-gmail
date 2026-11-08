import { IconButton } from '../../ui/Button';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { useUi } from '../../state/ui';
import { openUrl } from '../../lib/host';
import { REPO_URL } from '../../../shared/project';

export function SupportMenu() {
  return (
    <Menu trigger={<IconButton icon="help" label="Support" />} align="end">
      <MenuItem icon="keyboard" shortcut="?" onClick={() => useUi.getState().set({ shortcutsHelp: true })}>
        Keyboard shortcuts
      </MenuItem>
      <MenuItem icon="keyboard_command_key" shortcut="Ctrl K" onClick={() => useUi.getState().set({ palette: true })}>
        Command palette
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="help" onClick={() => openUrl('https://support.google.com/mail/')}>
        Gmail Help
      </MenuItem>
      <MenuItem icon="code" onClick={() => openUrl(REPO_URL)}>
        Expressive Gmail on GitHub
      </MenuItem>
    </Menu>
  );
}
