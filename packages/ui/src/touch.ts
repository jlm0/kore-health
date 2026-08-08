import type { Insets } from 'react-native';

// Touch-target floor for every interactive element: 48×48 pt (Android
// Material minimum; also satisfies WCAG 2.5.8). Visual size stays as
// designed — hitSlop invisibly expands the effective target instead.
export const MIN_TOUCH_TARGET = 48;

/** hitSlop that lifts an element of the given visual size to the 48 pt floor
 *  (never negative, so already-large elements are untouched). */
export function touchSlop(width: number, height = width): Insets {
  const v = Math.max(0, (MIN_TOUCH_TARGET - height) / 2);
  const h = Math.max(0, (MIN_TOUCH_TARGET - width) / 2);
  return { top: v, bottom: v, left: h, right: h };
}
