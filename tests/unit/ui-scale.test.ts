import { isUiScale, scaleTookEffect, stepUiScale, uiScaleLabel, UI_SCALES } from '../../src/shared/uiScale';

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

  it("tells a zoomed frame from one the engine left alone by the frame's pixel ratio", () => {
    expect(scaleTookEffect(0.800000011920929, 1, 0.8)).toBe(true);
    expect(scaleTookEffect(2.5, 2, 1.25)).toBe(true);
    // Browser zoom on Gmail itself scales the host's ratio, and the frame's with it.
    expect(scaleTookEffect(1.1 * 0.9, 1.1, 0.9)).toBe(true);
    expect(scaleTookEffect(1, 1, 0.8)).toBe(false);
    expect(scaleTookEffect(2, 2, 1.25)).toBe(false);
  });
});
