/**
 * Gmail's envelope from before 2020, redrawn on the 64 grid: no backdrop, cropped to the envelope,
 * and its shading cut to three flat greys so it stays clean at 16 pixels.
 */
const LEFT = 2;
const RIGHT = 62;
const TOP = 9.5;
const BOTTOM = 54.5;
const RADIUS = 4;
const STRIPE = 7.6;
// The M's arms meet here; its ends sit on the stripes' centre lines.
const VERTEX = { x: 32, y: 32.4 };
const END_Y = 13.3;
// Where the envelope's lower folds cross.
const CROSS = { x: 28, y: 40.3 };

const RED = '#de5145';
const RED_LEFT = '#d54c3f';
const RED_RIGHT = '#b63524';

export function paintClassicGmail(g: CanvasRenderingContext2D) {
  const inLeft = LEFT + STRIPE;
  const inRight = RIGHT - STRIPE;
  g.save();
  // The paper.
  g.beginPath();
  g.roundRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP, RADIUS);
  g.fillStyle = '#eeeeee';
  g.fill();
  g.clip();
  // The right fold, a touch darker.
  g.beginPath();
  g.moveTo(CROSS.x, CROSS.y);
  g.lineTo(inRight, 20);
  g.lineTo(inRight, BOTTOM);
  g.lineTo(42.2, BOTTOM);
  g.closePath();
  g.fillStyle = '#e1e1e1';
  g.fill();
  // The shadow the flap casts.
  g.beginPath();
  g.moveTo(inLeft, 19);
  g.lineTo(CROSS.x, CROSS.y);
  g.lineTo(VERTEX.x, VERTEX.y + 4);
  g.closePath();
  g.fillStyle = '#cccccc';
  g.fill();
  // The sides.
  g.fillStyle = RED_LEFT;
  g.fillRect(LEFT, END_Y, STRIPE, BOTTOM - END_Y);
  g.fillStyle = RED_RIGHT;
  g.fillRect(inRight, END_Y, STRIPE, BOTTOM - END_Y);
  g.restore();
  // The M.
  g.beginPath();
  g.moveTo(LEFT + STRIPE / 2, END_Y);
  g.lineTo(VERTEX.x, VERTEX.y);
  g.lineTo(RIGHT - STRIPE / 2, END_Y);
  g.strokeStyle = RED;
  g.lineWidth = STRIPE;
  g.lineCap = 'round';
  g.lineJoin = 'miter';
  g.stroke();
}
