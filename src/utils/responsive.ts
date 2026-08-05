import { Dimensions, PixelRatio } from 'react-native';

const { width, height } = Dimensions.get('window');

// Design baseline is iPhone (375 × 812)
const BASE_WIDTH  = 375;
const BASE_HEIGHT = 812;

export const SCREEN_WIDTH  = width;
export const SCREEN_HEIGHT = height;
export const isTablet      = width >= 768;

/**
 * Responsive font size.
 * factor controls how aggressively the size grows on larger screens.
 *   0   = no scaling (fixed)
 *   0.3 = gentle (recommended for body text)
 *   0.5 = moderate (good for headings)
 *   1.0 = fully linear
 */
export const rf = (size: number, factor = 0.3): number => {
  const scale      = width / BASE_WIDTH;
  const scaled     = size + (size * scale - size) * factor;
  return Math.round(PixelRatio.roundToNearestPixel(scaled));
};

/**
 * Responsive width/height (linear scale based on screen width).
 */
export const rw = (size: number): number =>
  Math.round(PixelRatio.roundToNearestPixel((width / BASE_WIDTH) * size));

/**
 * Responsive height (linear scale based on screen height).
 */
export const rh = (size: number): number =>
  Math.round(PixelRatio.roundToNearestPixel((height / BASE_HEIGHT) * size));
