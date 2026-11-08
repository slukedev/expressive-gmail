import { describe, expect, it } from 'vitest';
import { sanitizeEmail } from '../../src/app/lib/sanitize';

function run(html: string, blockRemoteImages = false) {
  let count = -1;
  const out = sanitizeEmail(html, { blockRemoteImages, blockTrackers: true, onTrackers: (n) => (count = n) });
  return { out, count };
}

describe('tracker blocking', () => {
  it('removes pixels by size and known open endpoints, and keeps real images', () => {
    const { out, count } = run(`
      <img src="https://news.example.com/hero.png" width="600" height="300" alt="Hero">
      <img src="https://news.example.com/x.gif" width="1" height="1">
      <img src="https://news.example.com/y.gif" style="width:0px;height:0px">
      <img src="https://u123.ct.sendgrid.net/wf/open?upn=abc">
      <img src="https://shop.example.com/logo.png" alt="Logo">
    `);
    expect(count).toBe(3);
    expect(out).toContain('hero.png');
    expect(out).toContain('logo.png');
    expect(out).not.toMatch(/x\.gif|y\.gif|sendgrid/);
  });

  it('keeps visible images whose styles merely mention zero, and mobile-only images hidden on desktop', () => {
    const { count } = run(`
      <img src="https://a.example.com/fade.png" style="opacity:0.85" width="300" height="100">
      <img src="https://a.example.com/btn.png" style="border-width:0;line-height:0;min-width:0" width="120" height="40">
      <img src="https://a.example.com/mobile-hero.jpg" style="display:none;max-height:0" width="320" height="180">
      <img src="https://img.example.com/pixel/phone-hero.jpg" width="640" height="360">
      <img src="https://a.example.com/wide.png" style="max-width:600px;width:100%">
    `);
    expect(count).toBe(0);
  });

  it('counts trackers before remote images are blocked, so they never show as placeholders', () => {
    const { out, count } = run('<img src="https://a.example.com/open.gif?id=1"><img src="https://a.example.com/photo.jpg" width="320" height="200">', true);
    expect(count).toBe(1);
    expect(out).not.toContain('open.gif');
    expect(out).toContain('data-blocked-src="https://a.example.com/photo.jpg"');
  });

  it('leaves inline and data images alone even when tiny', () => {
    const { count } = run('<img src="cid:spacer" width="1" height="1"><img src="data:image/png;base64,iVBORw0KGgo=" width="1" height="1">');
    expect(count).toBe(0);
  });
});
