import type { Point } from './energy';

export interface BurstVisual {
  radius: number;
  aftershockRadius: number;
  opacity: number;
  brightness: number;
  particles: number;
  bladeExpansion: number;
  motion: number;
}

const TAU = Math.PI * 2;
// The old peak was 1 + .95 * .9^1.2 times the normal blade radius.
const PEAK_BLADE_EXPANSION = (1 + .95 * Math.pow(.9, 1.2)) * 1.5 - 1;
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bounded = (value: number, max = 1) => Math.min(max, Math.max(0, finite(value)));

/** A pinwheel silhouette: one root and three cubic curves, repeated by quarter-turns. */
export function shurikenBlades(radius: number, phase: number): Point[][] {
  const r = bounded(radius, 1e6), angle = finite(phase) % TAU;
  const profile = [
    [.13, -.12], [.36, -.30], [.74, -.46], [1, -.22],
    [.73, -.20], [.72, .19], [.33, .22],
    [.27, .14], [.18, .11], [.12, .15],
  ];
  return Array.from({ length: 4 }, (_, blade) => {
    const a = angle + blade * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    return profile.map(([x, y]) => ({ x: (x * c - y * s) * r, y: (x * s + y * c) * r }));
  });
}

/** Screen-space shock reach is deliberately independent of continuous energy. */
export function farCornerRadius(width: number, height: number, x: number, y: number) {
  const nx = bounded(finite(x, .5)), ny = bounded(finite(y, .5));
  return Math.hypot(Math.max(nx, 1 - nx) * bounded(width, 1e6), Math.max(ny, 1 - ny) * bounded(height, 1e6));
}

/** Integrate velocity rather than multiplying absolute time by changing energy. */
export function advanceShurikenPhase(phase: number, dt: number, energy: number, charge: number, reducedMotion: boolean) {
  const velocity = (.65 + bounded(energy) * 1.75 + bounded(charge) * 2.1) * (reducedMotion ? .24 : 1);
  // Keep turns accumulated: wrapping here would jump consumers using phase * .25, etc.
  return finite(phase) + bounded(dt, .05) * velocity;
}

export function visualParticleCount(capacity: number, quality: number, reducedMotion: boolean) {
  return Math.floor(bounded(capacity, 300) * bounded(quality) * (reducedMotion ? .32 : 1));
}

export function burstVisual(width: number, height: number, x: number, y: number, progress: number, strength: number, reducedMotion: boolean): BurstVisual {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) {
    return { radius: 0, aftershockRadius: 0, opacity: 0, brightness: 0, particles: 0, bladeExpansion: 0, motion: 0 };
  }
  const power = .6 + bounded(strength) * .4;
  // At three seconds total: 90ms attack, one-second hold, then a two-second tail.
  const envelope = Math.min(1, progress / .03) * Math.pow(Math.min(1, (1 - progress) / (2 / 3)), 1.2);
  const travel = 1 - Math.pow(1 - progress, 3);
  const radius = farCornerRadius(width, height, x, y) * 1.8 * travel;
  const shortSide = Math.min(bounded(width, 1e6), bounded(height, 1e6));
  const motion = reducedMotion ? .28 : 1;
  return {
    radius,
    // The outer wave can leave the viewport; this inner pressure front cannot.
    aftershockRadius: Math.min(radius, shortSide * (.22 + .22 * travel)),
    opacity: envelope * power * (reducedMotion ? .46 : 1),
    brightness: envelope * power * (reducedMotion ? .3 : .8),
    particles: Math.floor(76 * power * (reducedMotion ? .28 : 1)),
    bladeExpansion: envelope * power * PEAK_BLADE_EXPANSION * motion,
    motion,
  };
}
