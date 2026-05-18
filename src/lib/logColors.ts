// Per-log color family palette for multi-log compare (M1.7 Push 3a/3b).
//
// Strategy: each loaded log is assigned a "family" by insertion order
// (log 1 = warm, log 2 = cool, log 3 = neutral). Above N=3 the families
// cycle — the roster warns visually when this happens. Each panel's
// existing per-axis hue (roll = red, pitch = yellow, yaw = blue) is
// then tinted TOWARD the log's family hue by a moderate blend so
// every (axis × log) trace is visually distinguishable.
//
// Concrete reading:
//   gyro_R from log 1  →  warm-leaning red       (orange-red base + warm tint)
//   gyro_R from log 2  →  cool-leaning red       (red base shifted toward cyan)
//   gyro_R from log 3  →  neutral-leaning red    (red base shifted toward amber-green)
//
// The HSL tinting itself isn't used by the roster chips (which just
// show the family's primary). The tinting helper is here so Push 3b
// chart panels can call it for per-(axis × log) trace colors.

export type LogFamily = 'warm' | 'cool' | 'neutral';

export interface FamilySpec {
  /** Display name — used in roster tooltips. */
  name: string;
  /** Primary hex color for the roster chip dot + the "untainted"
   *  reference color. */
  primary: string;
  /** Hue (0-360) used as the tint target when blending toward this
   *  family. Derived from `primary` for convenience; pinned here so
   *  the tinting math doesn't need a runtime hex→hsl pass for every
   *  trace. */
  hue: number;
}

/** Three families locked from the design pass:
 *   warm     — orange-red       (first-loaded log)
 *   cool     — cyan-blue        (second-loaded log)
 *   neutral  — amber-green      (third-loaded log)
 * Above N=3 we cycle through them — the roster surfaces a warning
 * chip so the user can see the collision. */
export const LOG_FAMILIES: readonly FamilySpec[] = [
  { name: 'warm',    primary: '#ff7a55', hue:  15 },
  { name: 'cool',    primary: '#5fc9ff', hue: 200 },
  { name: 'neutral', primary: '#9adb7c', hue: 105 },
];

/** Family assignment by load order (0-indexed). Cycles past 3. */
export function familyForIndex(loadOrderIndex: number): FamilySpec {
  const idx = ((loadOrderIndex % LOG_FAMILIES.length) + LOG_FAMILIES.length)
    % LOG_FAMILIES.length;
  return LOG_FAMILIES[idx];
}

/** True when the load order has hit the cycle (N >= 3 families exist
 *  and this index is a re-use). The roster shows a small warning
 *  chip when this returns true. */
export function isFamilyCycled(loadOrderIndex: number): boolean {
  return loadOrderIndex >= LOG_FAMILIES.length;
}

// -- HSL tinting (used by Push 3b chart panels) ---------------------------

/** Parse '#rrggbb' or '#rgb' to [r, g, b] in 0..255. */
function parseHex(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** RGB → HSL with H in 0..360 and S/L in 0..1. Standard formula. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60; break;
      case gn: h = ((bn - rn) / d + 2) * 60; break;
      case bn: h = ((rn - gn) / d + 4) * 60; break;
    }
  }
  return [h, s, l];
}

/** HSL → '#rrggbb'. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1)      { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else             { r = c; b = x; }
  const m = l - c / 2;
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  const hex = (v: number) => toByte(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Circular interpolation between two hues (0..360). Picks the shorter
 *  arc — avoids spinning around the wheel the long way. */
function lerpHue(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return ((a + d * t) + 360) % 360;
}

/** Take a base axis color (e.g. roll = '#ff8a8a') and tint it toward
 *  the given log family's hue. Saturation + lightness are preserved
 *  so the trace stays as visually "alive" as the original. The blend
 *  ratio is moderate (0.3) so each axis remains identifiable across
 *  logs while the log family is still legible.
 *
 *  Used by Push 3b chart panels: each trace's stroke color is
 *  `tintTowardFamily(axisBase, family)`. */
export function tintTowardFamily(
  baseColor: string,
  family: FamilySpec,
  blend = 0.3,
): string {
  const [r, g, b] = parseHex(baseColor);
  const [h, s, l] = rgbToHsl(r, g, b);
  const shifted = lerpHue(h, family.hue, blend);
  return hslToHex(shifted, s, l);
}
