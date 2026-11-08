import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Keeps the trigger mounted so it can animate between states. */
  disabled?: boolean;
}

// Keys that move focus because the person is walking the page.
const NAV_KEYS = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
let lastNavKey = -Infinity;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => NAV_KEYS.has(e.key) && (lastNavKey = performance.now()), true);
}

/** Opens on hover or on focus the person moved there; focus put back by code (a menu closing onto its trigger) leaves it shut. Wrap the app in <TooltipProvider> so neighbours open instantly. */
export function Tooltip({ content, children, side = 'bottom', disabled }: TooltipProps) {
  return (
    <BaseTooltip.Root
      disabled={disabled}
      onOpenChange={(open, details) => {
        if (open && details.reason === 'trigger-focus' && performance.now() - lastNavKey > 100) details.cancel();
      }}
    >
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="m3-tooltip-positioner">
          <BaseTooltip.Popup className="m3-tooltip">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={600} closeDelay={0} timeout={400}>
      {children}
    </BaseTooltip.Provider>
  );
}
