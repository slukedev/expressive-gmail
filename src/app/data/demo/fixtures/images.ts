/** Flat illustrations for image attachments, as real PNGs for download and SVGs for preview. */
import type { Scene, Shape } from '../files';

export function barChart(values: number[], color = '#0b57d0', accent = '#7cacf8'): Scene {
  const w = 560;
  const h = 300;
  const shapes: Shape[] = [];
  for (let i = 0; i <= 4; i++) shapes.push({ t: 'rect', x: 48, y: 40 + i * 50, w: 480, h: 1, fill: '#e3e3e3' });
  const max = Math.max(...values);
  const slot = 480 / values.length;
  values.forEach((v, i) => {
    const bh = Math.round((v / max) * 200);
    shapes.push({
      t: 'rect',
      x: Math.round(56 + i * slot),
      y: 240 - bh,
      w: Math.round(slot - 16),
      h: bh,
      r: 4,
      fill: i === values.length - 1 ? color : accent,
    });
  });
  shapes.push({ t: 'rect', x: 48, y: 240, w: 480, h: 2, fill: '#747775' });
  shapes.push({ t: 'rect', x: 48, y: 262, w: 90, h: 10, r: 5, fill: '#c4c7c5' });
  shapes.push({ t: 'rect', x: 48, y: 14, w: 160, h: 12, r: 6, fill: '#444746' });
  return { w, h, bg: '#ffffff', shapes };
}

export function lineChart(points: number[], color = '#146c2e'): Scene {
  const w = 560;
  const h = 300;
  const shapes: Shape[] = [];
  for (let i = 0; i <= 4; i++) shapes.push({ t: 'rect', x: 40, y: 40 + i * 50, w: 490, h: 1, fill: '#e3e3e3' });
  const max = Math.max(...points);
  const min = Math.min(...points);
  const step = 490 / (points.length - 1);
  const ys = points.map((p) => 230 - ((p - min) / (max - min || 1)) * 180);
  const top: number[] = [];
  ys.forEach((y, i) => top.push(40 + i * step, y));
  const area = [...top, 530, 240, 40, 240];
  shapes.push({ t: 'poly', pts: area.map(Math.round), fill: '#c4eed0' });
  ys.forEach((y, i) => shapes.push({ t: 'circle', cx: Math.round(40 + i * step), cy: Math.round(y), r: 4, fill: color }));
  shapes.push({ t: 'rect', x: 40, y: 14, w: 180, h: 12, r: 6, fill: '#444746' });
  return { w, h, bg: '#ffffff', shapes };
}

export function appScreen(variant: 'welcome' | 'workspace' | 'invite' | 'empty' | 'dark'): Scene {
  const dark = variant === 'dark';
  const bg = dark ? '#141218' : '#f8f9ff';
  const surface = dark ? '#2b2930' : '#ffffff';
  const ink = dark ? '#e6e0e9' : '#1b1b1f';
  const primary = dark ? '#d0bcff' : '#3a5ba9';
  const w = 360;
  const h = 640;
  const shapes: Shape[] = [
    { t: 'rect', x: 0, y: 0, w, h: 28, fill: dark ? '#1d1b20' : '#eef0f8' },
    { t: 'rect', x: 24, y: 64, w: 180, h: 18, r: 9, fill: ink },
    { t: 'rect', x: 24, y: 94, w: 260, h: 10, r: 5, fill: dark ? '#938f99' : '#8e9099' },
  ];
  if (variant === 'welcome') {
    shapes.push({ t: 'circle', cx: 180, cy: 250, r: 90, fill: '#dbe1ff' });
    shapes.push({ t: 'poly', pts: [120, 290, 180, 190, 240, 290], fill: primary });
    shapes.push({ t: 'circle', cx: 222, cy: 210, r: 18, fill: '#ffb4a8' });
    shapes.push({ t: 'rect', x: 24, y: 400, w: 312, h: 12, r: 6, fill: '#8e9099' });
    shapes.push({ t: 'rect', x: 24, y: 422, w: 240, h: 12, r: 6, fill: '#8e9099' });
    shapes.push({ t: 'rect', x: 24, y: 548, w: 312, h: 52, r: 26, fill: primary });
  } else if (variant === 'workspace' || variant === 'dark') {
    for (let i = 0; i < 4; i++) {
      const y = 132 + i * 104;
      shapes.push({ t: 'rect', x: 16, y, w: 328, h: 92, r: 16, fill: surface });
      shapes.push({ t: 'circle', cx: 52, cy: y + 46, r: 20, fill: ['#ffd8e4', '#c2e7ff', '#c4eed0', '#fde293'][i]! });
      shapes.push({ t: 'rect', x: 84, y: y + 30, w: 150 - i * 12, h: 12, r: 6, fill: ink });
      shapes.push({ t: 'rect', x: 84, y: y + 52, w: 200, h: 9, r: 4, fill: dark ? '#938f99' : '#a9abb3' });
    }
    shapes.push({ t: 'rect', x: 252, y: 556, w: 88, h: 56, r: 18, fill: primary });
  } else if (variant === 'invite') {
    shapes.push({ t: 'rect', x: 16, y: 132, w: 328, h: 56, r: 12, fill: surface });
    shapes.push({ t: 'rect', x: 32, y: 154, w: 170, h: 12, r: 6, fill: '#a9abb3' });
    for (let i = 0; i < 3; i++) {
      shapes.push({ t: 'circle', cx: 44, cy: 236 + i * 64, r: 20, fill: ['#e8def8', '#ffdbcb', '#b7e4e7'][i]! });
      shapes.push({ t: 'rect', x: 76, y: 228 + i * 64, w: 140, h: 12, r: 6, fill: ink });
      shapes.push({ t: 'rect', x: 252, y: 222 + i * 64, w: 84, h: 28, r: 14, fill: '#dbe1ff' });
    }
    shapes.push({ t: 'rect', x: 24, y: 548, w: 312, h: 52, r: 26, fill: primary });
  } else {
    shapes.push({ t: 'circle', cx: 180, cy: 300, r: 64, fill: '#e1e2ec' });
    shapes.push({ t: 'rect', x: 150, y: 282, w: 60, h: 40, r: 6, fill: '#c4c6d0' });
    shapes.push({ t: 'rect', x: 90, y: 396, w: 180, h: 14, r: 7, fill: ink });
    shapes.push({ t: 'rect', x: 70, y: 420, w: 220, h: 10, r: 5, fill: '#a9abb3' });
    shapes.push({ t: 'rect', x: 120, y: 456, w: 120, h: 40, r: 20, fill: primary });
  }
  return { w, h, bg, shapes };
}

export function landscape(variant: 'dusk' | 'lake' | 'coast'): Scene {
  const w = 640;
  const h = 420;
  const sky = { dusk: '#ffcf9e', lake: '#bfe3ff', coast: '#a7d8f0' }[variant];
  const shapes: Shape[] = [];
  const bands = { dusk: ['#ffb38a', '#f59a83', '#d97f8c'], lake: ['#a9d8fb', '#93cdf6', '#7fc1ef'], coast: ['#93cde8', '#82c3e0', '#6fb7d6'] }[variant];
  bands.forEach((c, i) => shapes.push({ t: 'rect', x: 0, y: 60 + i * 50, w, h: 50, fill: c }));
  shapes.push({ t: 'circle', cx: variant === 'dusk' ? 470 : 120, cy: variant === 'dusk' ? 200 : 90, r: 42, fill: variant === 'dusk' ? '#fff1c7' : '#fffbe6' });
  if (variant === 'coast') {
    shapes.push({ t: 'rect', x: 0, y: 250, w, h: 170, fill: '#2f7fa8' });
    shapes.push({ t: 'poly', pts: [0, 250, 0, 160, 120, 190, 260, 250], fill: '#c9a46b' });
    shapes.push({ t: 'poly', pts: [0, 420, 0, 340, 220, 360, 640, 420], fill: '#e8d3a2' });
    shapes.push({ t: 'rect', x: 380, y: 270, w: 60, h: 4, r: 2, fill: '#e0f2fb' });
    shapes.push({ t: 'rect', x: 470, y: 300, w: 90, h: 4, r: 2, fill: '#e0f2fb' });
  } else {
    shapes.push({ t: 'poly', pts: [0, 300, 140, 150, 260, 270, 360, 170, 520, 300], fill: variant === 'dusk' ? '#6b4f78' : '#5b7b8f' });
    shapes.push({ t: 'poly', pts: [200, 300, 420, 120, 640, 300], fill: variant === 'dusk' ? '#4e3a5c' : '#46667a' });
    shapes.push({ t: 'poly', pts: [380, 152, 420, 120, 460, 152, 440, 160, 420, 150, 400, 162], fill: '#f4f7fb' });
    shapes.push({ t: 'rect', x: 0, y: 300, w, h: 120, fill: variant === 'dusk' ? '#3c2f4a' : '#3a7ca5' });
    if (variant === 'lake') {
      shapes.push({ t: 'rect', x: 60, y: 330, w: 140, h: 4, r: 2, fill: '#9cc9e6' });
      shapes.push({ t: 'rect', x: 300, y: 360, w: 200, h: 4, r: 2, fill: '#9cc9e6' });
    }
    for (let i = 0; i < 7; i++) {
      const x = 20 + i * 34;
      shapes.push({ t: 'poly', pts: [x, 330, x + 14, 270, x + 28, 330], fill: '#1f3b2d' });
    }
  }
  return { w, h, bg: sky, shapes };
}

export function balconyPlants(): Scene {
  const shapes: Shape[] = [
    { t: 'rect', x: 0, y: 0, w: 480, h: 360, fill: '#f3e3cf' },
    { t: 'rect', x: 0, y: 360, w: 480, h: 240, fill: '#b98a5e' },
    { t: 'rect', x: 0, y: 352, w: 480, h: 12, fill: '#8a6240' },
  ];
  const pots: [number, string, string][] = [
    [60, '#c8643b', '#3f7d4e'],
    [200, '#e0dccf', '#5f9f5b'],
    [340, '#355c7d', '#2e6b3f'],
  ];
  for (const [x, pot, leaf] of pots) {
    for (let k = 0; k < 6; k++) {
      shapes.push({ t: 'circle', cx: x + 40 + ((k * 23) % 50) - 20, cy: 300 - k * 22, r: 26 - k * 2, fill: leaf });
    }
    shapes.push({ t: 'poly', pts: [x, 330, x + 80, 330, x + 70, 440, x + 10, 440], fill: pot });
    shapes.push({ t: 'rect', x: x - 4, y: 322, w: 88, h: 16, r: 4, fill: pot });
  }
  shapes.push({ t: 'circle', cx: 252, cy: 210, r: 10, fill: '#f6c445' });
  shapes.push({ t: 'circle', cx: 236, cy: 236, r: 8, fill: '#f6c445' });
  return { w: 480, h: 600, bg: '#f3e3cf', shapes };
}

export function ceilingStain(): Scene {
  return {
    w: 480,
    h: 360,
    bg: '#eeeae2',
    shapes: [
      { t: 'rect', x: 0, y: 300, w: 480, h: 60, fill: '#d8d2c6' },
      { t: 'circle', cx: 250, cy: 150, r: 90, fill: '#e2d6bf' },
      { t: 'circle', cx: 240, cy: 140, r: 62, fill: '#d6c49f' },
      { t: 'circle', cx: 262, cy: 160, r: 38, fill: '#c7ae80' },
      { t: 'circle', cx: 248, cy: 148, r: 14, fill: '#b2955f' },
      { t: 'rect', x: 120, y: 296, w: 240, h: 6, fill: '#ffffff' },
    ],
  };
}

export function cakePhoto(): Scene {
  return {
    w: 480,
    h: 480,
    bg: '#fbe7e1',
    shapes: [
      { t: 'rect', x: 0, y: 330, w: 480, h: 150, fill: '#e9c9a8' },
      { t: 'circle', cx: 240, cy: 380, r: 150, fill: '#ffffff' },
      { t: 'rect', x: 110, y: 220, w: 260, h: 150, r: 18, fill: '#f6d6e3' },
      { t: 'rect', x: 110, y: 220, w: 260, h: 30, r: 14, fill: '#fff5f8' },
      { t: 'rect', x: 150, y: 300, w: 180, h: 10, r: 5, fill: '#e58fb0' },
      { t: 'rect', x: 196, y: 150, w: 10, h: 70, r: 3, fill: '#86c5da' },
      { t: 'rect', x: 274, y: 150, w: 10, h: 70, r: 3, fill: '#86c5da' },
      { t: 'circle', cx: 201, cy: 140, r: 9, fill: '#ffb300' },
      { t: 'circle', cx: 279, cy: 140, r: 9, fill: '#ffb300' },
    ],
  };
}
