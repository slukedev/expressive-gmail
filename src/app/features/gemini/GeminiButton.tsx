import { Tooltip } from '../../ui/Tooltip';
import { Ripple } from '../../ui/Ripple';
import { useGeminiPanel } from './panel';
import { Spark } from './Spark';
import { useGeminiFeature } from './useGemini';

export function GeminiButton() {
  const enabled = useGeminiFeature('chat');
  const open = useGeminiPanel((s) => s.open);
  const toggle = useGeminiPanel((s) => s.toggle);
  if (!enabled) return null;
  return (
    <Tooltip content={open ? 'Hide Gemini' : 'Ask Gemini'}>
      <button
        type="button"
        className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default gemini-button"
        aria-label="Ask Gemini"
        aria-pressed={open}
        data-selected={open || undefined}
        onClick={toggle}
      >
        <Spark size={24} />
        <Ripple />
      </button>
    </Tooltip>
  );
}
