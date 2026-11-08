import { describe, expect, it } from 'vitest';
import { adaptDocument, contrast, darkBackground, parseColor, readableText, type Rgb } from '../../src/app/features/darkmail/adapt';

const PAPER: Rgb = { r: 30, g: 31, b: 32, a: 1 };
const hex = (h: string) => parseColor(h)!;

describe('darkBackground', () => {
  it('puts white exactly on the paper and keeps dark colors as they are', () => {
    const white = darkBackground(hex('#ffffff'), PAPER);
    expect(contrast(white, PAPER)).toBeLessThan(1.02);
    const banner = hex('#111111');
    expect(darkBackground(banner, PAPER)).toBe(banner);
    const button = hex('#cc0000');
    expect(darkBackground(button, PAPER)).toBe(button);
  });

  it('keeps a tint warm or cool instead of turning it gray', () => {
    const cream = darkBackground(hex('#fffdf7'), PAPER);
    expect(cream.r).toBeGreaterThan(cream.b);
    const ice = darkBackground(hex('#e8f0fe'), PAPER);
    expect(ice.b).toBeGreaterThan(ice.r);
  });

  it('keeps the order of light tints, so a card still sits on its page', () => {
    const page = darkBackground(hex('#f4f4f4'), PAPER);
    const card = darkBackground(hex('#ffffff'), PAPER);
    expect(page.r).toBeGreaterThan(card.r);
  });
});

describe('readableText', () => {
  const bg = darkBackground(hex('#ffffff'), PAPER);

  it.each(['#000000', '#222222', '#5f6368', '#0b57d0', '#d00000', '#188038', '#9334e6', '#3b362c'])(
    '%s ends up readable on the darkened page',
    (color) => {
      const out = readableText(hex(color), bg);
      expect(contrast(out, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps the hue of colored text, so links still look like links', () => {
    const link = readableText(hex('#0b57d0'), bg);
    expect(link.b).toBeGreaterThan(link.r);
    const alert = readableText(hex('#d00000'), bg);
    expect(alert.r).toBeGreaterThan(alert.g);
  });

  it('leaves text that already reads well untouched', () => {
    const white = hex('#ffffff');
    expect(readableText(white, bg)).toBe(white);
  });
});

describe('adaptDocument', () => {
  it('darkens the page, lightens what sits on it and spares dark banners and pictures', () => {
    // The real thing runs on the message's iframe document.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML = `
      <table id="page" style="background-color:#ffffff;color:#222222"><tr><td>
        <p id="body" style="color:#333333">Hello</p>
        <a id="link" style="color:#0b57d0" href="#">Read more</a>
        <div id="banner" style="background-color:#111111;color:#ffffff">FREE SOCKS.</div>
        <img id="pic" style="background-color:#ffffff" src="x.png">
      </td></tr></table>`;
    adaptDocument(doc, PAPER);
    const get = (id: string) => doc.getElementById(id)!.style;
    const page = parseColor(get('page').backgroundColor)!;
    expect(contrast(page, PAPER)).toBeLessThan(1.05);
    expect(contrast(parseColor(get('body').color)!, page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseColor(get('link').color)!, page)).toBeGreaterThanOrEqual(4.5);
    // Dark already: no overrides.
    expect(get('banner').getPropertyValue('background-color')).toBe('rgb(17, 17, 17)');
    expect(get('banner').getPropertyPriority('color')).toBe('');
    expect(get('pic').getPropertyPriority('background-color')).toBe('');
  });
});
