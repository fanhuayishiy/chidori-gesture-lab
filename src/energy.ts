export interface EnergyState { x: number; y: number; expansion: number }
export interface Point { x: number; y: number }
export const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));

export class EnergyField {
  readonly current: EnergyState = { x: .55, y: .48, expansion: .28 };
  private target: EnergyState = { ...this.current };

  setTarget(target: Partial<EnergyState>) {
    for (const key of ['x', 'y', 'expansion'] as const) {
      const value = target[key];
      if (value !== undefined && Number.isFinite(value)) this.target[key] = clamp(value);
    }
  }

  update(dt: number): EnergyState {
    const blend = 1 - Math.exp(-Math.max(0, Math.min(dt, 1)) * 6);
    for (const key of ['x', 'y', 'expansion'] as const) {
      this.current[key] += (this.target[key] - this.current[key]) * blend;
    }
    return this.current;
  }
}

export function coverageRadius(width: number, height: number, x: number, y: number, expansion: number) {
  const farthest = Math.hypot(Math.max(x, 1 - x) * width, Math.max(y, 1 - y) * height);
  return 44 + (farthest * 1.12 - 44) * Math.pow(clamp(expansion), 1.25);
}

/** Midpoint displacement: a stable seed holds arcs briefly instead of strobing every frame. */
export function generateBolt(x1: number, y1: number, x2: number, y2: number, seed: number): Point[] {
  let state = seed | 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 0) / 4294967296; };
  let points: Point[] = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  let displacement = Math.hypot(x2 - x1, y2 - y1) * .21;
  for (let depth = 0; depth < 5; depth++) {
    const next: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      next.push({ x: (a.x + b.x) / 2 + (random() - .5) * displacement, y: (a.y + b.y) / 2 + (random() - .5) * displacement }, b);
    }
    points = next; displacement *= .52;
  }
  return points;
}
