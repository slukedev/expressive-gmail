import { applyFrameScale, isUiScale, scaleTookEffect, stepUiScale, uiScaleLabel, UI_SCALES } from '../../src/shared/uiScale';

describe('interface size', () => {
  it('steps through the sizes and holds at the ends', () => {
    expect(stepUiScale(1, -1)).toBe(0.9);
    expect(stepUiScale(1, 1)).toBe(1.1);
    expect(stepUiScale(1.1, 1)).toBe(1.25);
    expect(stepUiScale(1.25, 1)).toBe(1.25);
    expect(stepUiScale(0.8, -1)).toBe(0.8);
    // Anything off the list steps from 100%.
    expect(stepUiScale(0.95, 1)).toBe(1.1);
  });

  it('only takes the sizes on offer', () => {
    expect(UI_SCALES.every(isUiScale)).toBe(true);
    expect([0, 0.5, 0.95, 2, '1', null, NaN].some(isUiScale)).toBe(false);
  });

  it('labels each size as a whole percentage', () => {
    expect(UI_SCALES.map(uiScaleLabel)).toEqual(['80%', '90%', '100%', '110%', '125%']);
  });

  it('tells a zoomed frame from one the engine left alone by its viewport width', () => {
    // A 1366px wide frame at 80% lays out at 1707.5px.
    expect(scaleTookEffect(1707.5, 1366, 0.8)).toBe(true);
    expect(scaleTookEffect(1093, 1366, 1.25)).toBe(true);
    // Left at the host's width, or a smaller box with the app laid out unzoomed inside it.
    expect(scaleTookEffect(1366, 1366, 0.8)).toBe(false);
    expect(scaleTookEffect(1092.8, 1092.8, 0.8)).toBe(false);
  });

  describe('sizing the frame', () => {
    function hosted(shrinks: boolean) {
      const host = document.createElement('div');
      const frame = document.createElement('iframe');
      host.append(frame);
      document.body.append(host);
      Object.defineProperty(host, 'clientWidth', { value: 1200 });
      // WebKit shrinks a zoomed frame's box with the zoom; Chromium and Firefox keep it.
      frame.getBoundingClientRect = () => {
        const zoom = Number(frame.style.zoom) || 1;
        const grown = parseFloat(frame.style.width || '100') / 100;
        return { width: 1200 * grown * (shrinks ? zoom : 1) } as DOMRect;
      };
      return frame;
    }

    it('leaves the box alone where the engine keeps it at size', () => {
      const frame = hosted(false);
      applyFrameScale(frame, 0.8);
      expect([frame.style.zoom, frame.style.width, frame.style.height]).toEqual(['0.8', '100%', '100%']);
    });

    it('grows the box back where the engine shrinks it, and undoes that on the way back', () => {
      const frame = hosted(true);
      applyFrameScale(frame, 0.8);
      expect([frame.style.zoom, frame.style.width, frame.style.height]).toEqual(['0.8', '125%', '125%']);
      expect(frame.getBoundingClientRect().width).toBe(1200);
      applyFrameScale(frame, 1.25);
      expect([frame.style.width, frame.style.height]).toEqual(['80%', '80%']);
      expect(frame.getBoundingClientRect().width).toBe(1200);
      applyFrameScale(frame, 1);
      expect([frame.style.zoom, frame.style.width, frame.style.height]).toEqual(['', '100%', '100%']);
    });
  });
});
