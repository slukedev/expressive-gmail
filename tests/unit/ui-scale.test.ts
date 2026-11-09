import { applyFrameScale, isUiScale, readHostUiScale, serveFrameScale, stepUiScale, uiScaleLabel, UI_SCALES } from '../../src/shared/uiScale';

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

  describe('sizing the frame', () => {
    const style = (f: HTMLIFrameElement) => [f.style.transform, f.style.transformOrigin, f.style.width, f.style.height, f.dataset.scale];

    it('lays the frame out larger and scales it down from its corner to fill the host, and back', () => {
      const frame = document.createElement('iframe');
      applyFrameScale(frame, 0.8);
      expect(style(frame)).toEqual(['scale(0.8)', '0 0', '125%', '125%', '0.8']);
      applyFrameScale(frame, 1.25);
      expect(style(frame)).toEqual(['scale(1.25)', '0 0', '80%', '80%', '1.25']);
      // A new tab opens at the last size before the app has loaded.
      expect(readHostUiScale()).toBe(1.25);
      applyFrameScale(frame, 1);
      expect(style(frame)).toEqual(['', '', '100%', '100%', undefined]);
      expect(readHostUiScale()).toBe(1);
    });

    it('takes only the sizes on offer from the app', () => {
      const frame = document.createElement('iframe');
      for (const asked of [0.5, '0.8', null]) serveFrameScale(frame, asked);
      expect(frame.style.transform).toBe('');
      serveFrameScale(frame, 0.9);
      expect(frame.style.transform).toBe('scale(0.9)');
    });
  });
});
