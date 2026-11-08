import type { ShapeName } from '../../ui/ShapeIcon';

/** From Material's expressive set; the cookie is the default. */
export const PICTURE_SHAPES = [
  { shape: 'Cookie9Sided', label: 'Cookie' },
  { shape: 'Circle', label: 'Circle' },
  { shape: 'Square', label: 'Rounded square' },
  { shape: 'Cookie4Sided', label: 'Soft square' },
  { shape: 'Cookie12Sided', label: 'Scallop' },
  { shape: 'Sunny', label: 'Sun' },
  { shape: 'SoftBurst', label: 'Burst' },
  { shape: 'Flower', label: 'Flower' },
  { shape: 'Clover4Leaf', label: 'Four-leaf clover' },
  { shape: 'Clover8Leaf', label: 'Eight-leaf clover' },
  { shape: 'Puffy', label: 'Puffy' },
  { shape: 'PuffyDiamond', label: 'Puffy diamond' },
  { shape: 'Gem', label: 'Gem' },
  { shape: 'Arch', label: 'Arch' },
  { shape: 'Ghostish', label: 'Ghost' },
  { shape: 'Heart', label: 'Heart' },
] as const satisfies readonly { shape: ShapeName; label: string }[];

export type PictureShape = (typeof PICTURE_SHAPES)[number]['shape'];
