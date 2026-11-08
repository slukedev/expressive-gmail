/** Flat shapes only, so they read as drawings and never as photos of a real person. */
import { hashString, svgDataUri } from './util';

const BACKGROUNDS = ['#c2e7ff', '#c4eed0', '#ffdbcb', '#e8def8', '#fde293', '#d3e3fd', '#f9dedc', '#b7e4e7'];
const SKIN = ['#f1c7a5', '#d9a07a', '#a86f4c', '#7a4b31', '#e8b896', '#c58c62'];
const HAIR = ['#2d1e16', '#5a3825', '#a0522d', '#1f1f1f', '#d9a441', '#7b6a58', '#3b2a4d'];
const SHIRT = ['#0b57d0', '#146c2e', '#8c1d18', '#6750a4', '#b3261e', '#006a6a', '#7d5260', '#3f5f90'];

function pick<T>(list: T[], n: number): T {
  return list[n % list.length]!;
}

function avatarSvg(key: string): string {
  const h = hashString(key);
  const bg = pick(BACKGROUNDS, h);
  const skin = pick(SKIN, h >>> 3);
  const hair = pick(HAIR, h >>> 6);
  const shirt = pick(SHIRT, h >>> 9);
  const style = (h >>> 12) % 4;
  const hairShape = [
    '<path d="M28 42c0-14 9-22 20-22s20 8 20 22c-3-6-9-10-20-10s-17 4-20 10z" fill="HAIR"/>',
    '<path d="M26 46c-2-18 8-28 22-28s24 10 22 28c-2-4-4-8-6-9-6 3-20 3-32 0-2 1-4 5-6 9z" fill="HAIR"/><path d="M26 44c-2 12 0 22 4 28h6c-4-8-6-18-4-26z" fill="HAIR"/><path d="M70 44c2 12 0 22-4 28h-6c4-8 6-18 4-26z" fill="HAIR"/>',
    '<circle cx="48" cy="30" r="15" fill="HAIR"/><path d="M30 40c2-8 9-13 18-13s16 5 18 13c-6-3-12-4-18-4s-12 1-18 4z" fill="HAIR"/>',
    '<path d="M30 38c2-10 9-16 18-16s16 6 18 16l-2 2c-4-4-10-6-16-6s-12 2-16 6z" fill="HAIR"/>',
  ][style]!.replace(/HAIR/g, hair);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
    <rect width="96" height="96" fill="${bg}"/>
    <path d="M14 96c2-18 16-28 34-28s32 10 34 28z" fill="${shirt}"/>
    <rect x="42" y="56" width="12" height="14" rx="5" fill="${skin}"/>
    <ellipse cx="48" cy="44" rx="16" ry="18" fill="${skin}"/>
    ${hairShape}
    <circle cx="42" cy="46" r="1.8" fill="#2b2b2b"/><circle cx="54" cy="46" r="1.8" fill="#2b2b2b"/>
    <path d="M43 53c3 2.5 7 2.5 10 0" stroke="#7a3b2e" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </svg>`;
}

export function avatarUrl(key: string): string {
  return svgDataUri(avatarSvg(key));
}
