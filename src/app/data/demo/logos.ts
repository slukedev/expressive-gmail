/** Logos for some invented brands, standing in for Google's favicon service (which the demo never calls). Domains without one show the initial, like a real brand with no usable logo. */
import { svgDataUri } from './util';

const svg = (body: string) => svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${body}</svg>`);

const LOGOS: Record<string, string> = {
  // A berry cluster on a green tile.
  'junipersavings.example': svg(
    '<rect width="128" height="128" rx="28" fill="#1e6b4f"/><circle cx="50" cy="70" r="18" fill="#cfe8dc"/><circle cx="78" cy="70" r="18" fill="#cfe8dc"/><circle cx="64" cy="46" r="18" fill="#ffffff"/>',
  ),
  // A winding path ending in an arrow, on orange.
  'parcelpath.example': svg(
    '<rect width="128" height="128" fill="#e8711a"/><path d="M30 92 C30 64 64 74 64 52 C64 36 80 32 92 34" stroke="#ffffff" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M84 20 L102 36 L82 48 Z" fill="#ffffff"/>',
  ),
  // A wing on blue, drawn as a circle tile.
  'albatrossair.example': svg('<circle cx="64" cy="64" r="64" fill="#1b4fa8"/><path d="M24 74 C52 50 80 44 106 46 C86 56 66 70 52 86 Z" fill="#ffffff"/>'),
  // A wave with no background of its own.
  'lowtidecoffee.example': svg('<path d="M14 76 C34 56 50 56 64 70 C78 84 94 84 114 64 L114 92 C94 108 78 108 64 96 C50 84 34 84 14 100 Z" fill="#5b3a29"/>'),
  // Two chevrons on near-black.
  'codehub.example': svg('<rect width="128" height="128" rx="24" fill="#202124"/><path d="M52 40 L28 64 L52 88" stroke="#ffffff" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M76 40 L100 64 L76 88" stroke="#ffffff" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  // A fork on red.
  'forkful.example': svg(
    '<rect width="128" height="128" rx="64" fill="#c62f3b"/><rect x="46" y="30" width="8" height="30" rx="4" fill="#fff"/><rect x="60" y="30" width="8" height="30" rx="4" fill="#fff"/><rect x="74" y="30" width="8" height="30" rx="4" fill="#fff"/><path d="M46 56 H82 C82 68 74 74 64 74 C54 74 46 68 46 56 Z" fill="#fff"/><rect x="59" y="70" width="10" height="30" rx="5" fill="#fff"/>',
  ),
};

export function demoLogo(domain: string): string | undefined {
  return LOGOS[domain];
}
