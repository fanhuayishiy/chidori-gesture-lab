import { describe, expect, it } from 'vitest';
import { projectCoverPoint, visibleCoverHands, type FrameSize } from './camera-projection';
import { analyzeHands, type Landmark } from './gesture';

const source = { width: 640, height: 480 };
const landscape = { width: 1280, height: 720 };
const portrait = { width: 480, height: 800 };

function handAt(x: number, y: number): Landmark[] {
  const hand = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  hand[0] = { x, y: y + .08, z: 0 };
  [5, 9, 13, 17].forEach((base, finger) => {
    const baseX = x + (finger - 1.5) * .025;
    hand[base] = { x: baseX, y: y - .02, z: 0 };
    for (let joint = 1; joint <= 3; joint++) {
      hand[base + joint] = { x: baseX, y: y - .02 - joint * .03, z: 0 };
    }
  });
  return hand;
}

describe('projectCoverPoint', () => {
  it('preserves already-mirrored coordinates when aspect ratios match', () => {
    expect(projectCoverPoint({ x: .75, y: .25 }, source, { width: 1280, height: 960 }))
      .toEqual({ x: .75, y: .25 });
    expect(projectCoverPoint({ x: 0, y: 0 }, source, source)).toEqual({ x: 0, y: 0 });
  });

  it('accounts for centered vertical cropping in a landscape viewport', () => {
    const point = projectCoverPoint({ x: .75, y: .25 }, source, landscape);
    expect(point?.x).toBeCloseTo(.75);
    expect(point?.y).toBeCloseTo(1 / 6);
  });

  it('accounts for centered horizontal cropping in a portrait viewport', () => {
    const point = projectCoverPoint({ x: .6, y: .25 }, source, portrait);
    expect(point?.x).toBeCloseTo(13 / 18);
    expect(point?.y).toBeCloseTo(.25);
    expect(projectCoverPoint({ x: .5, y: .5 }, source, portrait)).toEqual({ x: .5, y: .5 });
  });

  it('does not clamp points outside the visible crop', () => {
    expect(projectCoverPoint({ x: .5, y: 0 }, source, landscape)?.y).toBeCloseTo(-1 / 6);
    expect(projectCoverPoint({ x: .5, y: 1 }, source, landscape)?.y).toBeCloseTo(7 / 6);
    expect(projectCoverPoint({ x: -1, y: 2 }, source, source)).toEqual({ x: -1, y: 2 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid source or viewport dimensions: %s', (value) => {
      for (const dimension of ['width', 'height'] as const) {
        const invalid: FrameSize = { ...source, [dimension]: value };
        expect(projectCoverPoint({ x: .5, y: .5 }, invalid, landscape)).toBeNull();
        expect(projectCoverPoint({ x: .5, y: .5 }, source, invalid)).toBeNull();
      }
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite point coordinates: %s', (value) => {
      expect(projectCoverPoint({ x: value, y: .5 }, source, landscape)).toBeNull();
      expect(projectCoverPoint({ x: .5, y: value }, source, landscape)).toBeNull();
    },
  );
});

describe('visibleCoverHands', () => {
  it('omits palms hidden above or below a landscape camera crop', () => {
    const visible = handAt(.25, .5);
    expect(visibleCoverHands([handAt(.5, .05), visible, handAt(.5, .95)], source, landscape))
      .toEqual([visible]);
  });

  it('omits palms hidden to either side of a portrait camera crop', () => {
    const visible = handAt(.6, .5);
    expect(visibleCoverHands([handAt(.1, .5), visible, handAt(.9, .5)], source, portrait))
      .toEqual([visible]);
  });

  it('uses the mean palm center rather than wrist or fingertips for visibility', () => {
    const visible = handAt(.5, .14);
    visible[8].y = -.5;
    const hidden = handAt(.5, .09);
    expect(hidden[0].y).toBeGreaterThan(.125);
    expect(visibleCoverHands([visible, hidden], source, landscape)).toEqual([visible]);
  });

  it('keeps palms on the exact crop boundary', () => {
    const upper = Array.from({ length: 21 }, () => ({ x: .5, y: .125 }));
    const lower = Array.from({ length: 21 }, () => ({ x: .5, y: .875 }));
    expect(visibleCoverHands([upper, lower], source, landscape)).toEqual([upper, lower]);
  });

  it('ignores incomplete, sparse, and non-finite landmark sets', () => {
    const invalidX = handAt(.5, .5);
    invalidX[8].x = Number.NaN;
    const invalidY = handAt(.5, .5);
    invalidY[4].y = Number.POSITIVE_INFINITY;
    const invalidZ = handAt(.5, .5);
    invalidZ[20].z = Number.NaN;
    const sparse = new Array<Landmark>(21);
    const valid = handAt(.5, .5).map(({ x, y }) => ({ x, y }));
    expect(visibleCoverHands([[], valid.slice(0, 20), invalidX, invalidY, invalidZ, sparse, valid], source, landscape))
      .toEqual([valid]);
  });

  it('has no visible hands before valid frame dimensions are available', () => {
    expect(visibleCoverHands([handAt(.5, .5)], { width: 0, height: 480 }, landscape)).toEqual([]);
    expect(visibleCoverHands([handAt(.5, .5)], source, { width: 1280, height: Number.NaN })).toEqual([]);
  });

  it('preserves original landmarks and gesture openness and expansion', () => {
    const hands = [handAt(.35, .5), handAt(.65, .5)];
    const before = structuredClone(hands);
    const reading = analyzeHands(hands)!;
    const visible = visibleCoverHands(hands, source, portrait);
    expect(hands).toEqual(before);
    expect(visible).not.toBe(hands);
    expect(visible[0]).toBe(hands[0]);
    expect(visible[1]).toBe(hands[1]);
    expect(analyzeHands(visible)).toEqual(reading);
    expect(visible[0][0].x).toBe(.35);
  });
});
