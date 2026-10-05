import { describe, expect, it } from 'vitest';
import { analyzeHands, type Landmark } from './gesture';

function pose(open: boolean): Landmark[] {
  const hand: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  hand[0] = { x: 0.5, y: 0.8, z: 0 };
  [[0.4, 0.6], [0.48, 0.57], [0.56, 0.6], [0.64, 0.64]].forEach(([x, y], finger) => {
    const base = 5 + finger * 4;
    hand[base] = { x, y, z: 0 };
    hand[base + 1] = { x, y: y - (open ? 0.13 : 0.07), z: 0 };
    hand[base + 2] = { x, y: y + (open ? -0.21 : 0.01), z: 0 };
    hand[base + 3] = { x, y: y + (open ? -0.28 : 0.07), z: 0 };
  });
  return hand;
}

describe('analyzeHands', () => {
  it('contracts a fist and expands an open palm', () => {
    expect(analyzeHands([pose(false)])?.expansion).toBeLessThan(0.15);
    expect(analyzeHands([pose(true)])?.expansion).toBeGreaterThan(0.9);
  });

  it('is invariant to hand rotation and scale', () => {
    for (const open of [false, true]) {
      const original = pose(open);
      const rotated = original.map(({ x, y }) => ({ x: 0.5 - (y - 0.5) * 0.43, y: 0.5 + (x - 0.5) * 0.43 }));
      expect(analyzeHands([rotated])?.openness).toBeCloseTo(analyzeHands([original])!.openness, 5);
    }
  });

  it('mirrors the palm center horizontally for a selfie display', () => {
    const hand = pose(true).map((point) => ({ ...point, x: point.x - 0.25 }));
    const reading = analyzeHands([hand])!;
    const palmIndices = [0, 5, 9, 13, 17];
    expect(reading.x).toBeCloseTo(1 - palmIndices.reduce((sum, index) => sum + hand[index].x, 0) / 5);
    expect(reading.handCount).toBe(1);
  });

  it('uses two-hand separation for contraction and full expansion', () => {
    const at = (offset: number) => pose(false).map((point) => ({ ...point, x: point.x + offset }));
    expect(analyzeHands([at(-0.04), at(0.04)])?.expansion).toBeLessThan(0.1);
    const spread = analyzeHands([at(-0.38), at(0.38)])!;
    expect(spread.expansion).toBeGreaterThan(0.95);
    expect(spread.handCount).toBe(2);
    expect(spread.x).toBeCloseTo(analyzeHands([pose(false)])!.x);
  });

  it('ignores incomplete, non-finite, and collapsed landmark sets', () => {
    expect(analyzeHands([])).toBeNull();
    expect(analyzeHands([[{ x: 0.5, y: 0.5 }]])).toBeNull();
    expect(analyzeHands([Array.from({ length: 21 }, () => ({ x: 0, y: 0 }))])).toBeNull();
    const bad = pose(true);
    bad[8].x = Number.NaN;
    expect(analyzeHands([bad])).toBeNull();
    expect(analyzeHands([bad, pose(true)])?.handCount).toBe(1);
  });

  it('returns bounded coordinates for partially offscreen valid hands', () => {
    const outside = pose(true).map((point) => ({ ...point, x: point.x + 2, y: point.y - 3 }));
    const reading = analyzeHands([outside])!;
    expect(reading.x).toBe(0);
    expect(reading.y).toBe(0);
    expect(reading.expansion).toBeGreaterThanOrEqual(0);
    expect(reading.expansion).toBeLessThanOrEqual(1);
  });
});
