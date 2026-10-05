import { afterEach, describe, expect, it, vi } from 'vitest';
import { LightningRenderer } from './lightning';
import { ShurikenRenderer } from './shuriken';
import type { EffectSnapshot } from './effects';
import * as energy from './energy';
import {
  advanceShurikenPhase,
  burstVisual,
  farCornerRadius,
  shurikenBlades,
  visualParticleCount,
} from './effect-visuals';

describe('four-blade wind geometry', () => {
  it('forms four broad curved blades with exact quarter-turn symmetry', () => {
    const blades = shurikenBlades(200, .37);
    expect(blades).toHaveLength(4);
    expect(blades[0]).toHaveLength(10); // Start plus three cubic curves.
    for (let blade = 1; blade < 4; blade++) {
      for (let point = 0; point < blades[0].length; point++) {
        const previous = blades[blade - 1][point], next = blades[blade][point];
        expect(next.x).toBeCloseTo(-previous.y, 8);
        expect(next.y).toBeCloseTo(previous.x, 8);
      }
    }
    expect(Math.hypot(blades[0][3].x, blades[0][3].y)).toBeGreaterThan(190);
  });

  it('scales proportionally without changing the blade silhouette', () => {
    const small = shurikenBlades(50, .8), large = shurikenBlades(250, .8);
    small.flat().forEach((point, i) => {
      expect(large.flat()[i].x).toBeCloseTo(point.x * 5, 8);
      expect(large.flat()[i].y).toBeCloseTo(point.y * 5, 8);
    });
  });

  it('sanitizes invalid geometry inputs to finite points', () => {
    for (const value of [NaN, Infinity, -Infinity, -20, 1e308]) {
      expect(shurikenBlades(value, value).flat().every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(Number.isFinite(farCornerRadius(value, value, value, value))).toBe(true);
    }
  });
});

describe('continuous wind phase', () => {
  it('changes angular velocity, not angle, when charge or energy changes', () => {
    expect(advanceShurikenPhase(2.1, 0, 0, 0, false)).toBe(2.1);
    expect(advanceShurikenPhase(2.1, 0, 1, 1, false)).toBe(2.1);
    expect(advanceShurikenPhase(2.1, 1 / 60, 1, 1, false) - 2.1).toBeLessThan(.15);
  });

  it('integrates equally at 30 and 60 fps', () => {
    let sixty = 0, thirty = 0;
    for (let i = 0; i < 60; i++) sixty = advanceShurikenPhase(sixty, 1 / 60, .5, .3, false);
    for (let i = 0; i < 30; i++) thirty = advanceShurikenPhase(thirty, 1 / 30, .5, .3, false);
    expect(sixty).toBeCloseTo(thirty, 8);
  });

  it('bounds resume gaps and reduces movement without reversing rotation', () => {
    const normal = advanceShurikenPhase(0, .05, 1, 1, false);
    expect(advanceShurikenPhase(0, 900, 1, 1, false)).toBe(normal);
    expect(advanceShurikenPhase(0, .05, 1, 1, true)).toBeLessThan(normal * .4);
    expect(advanceShurikenPhase(2, -1, 1, 1, false)).toBe(2);
    expect(Number.isFinite(advanceShurikenPhase(NaN, Infinity, NaN, Infinity, false))).toBe(true);
  });

  it('preserves accumulated phase across a full turn for slower fractional-phase layers', () => {
    const before = Math.PI * 2 - .01;
    const after = advanceShurikenPhase(before, .01, 1, 1, false);
    expect(after - before).toBeCloseTo(.045, 10);
    expect(after).toBeGreaterThan(Math.PI * 2);
  });
});

describe('bounded one-shot burst envelope', () => {
  it('attacks within 90ms, holds through one second, then fades continuously to three seconds', () => {
    const at = (ms: number) => burstVisual(1440, 900, .5, .5, ms / 3000, 1, false);
    expect(at(0).opacity).toBe(0);
    expect(at(45).opacity).toBeCloseTo(.5);
    expect(at(90).opacity).toBe(1);
    expect(at(500).opacity).toBe(1);
    expect(at(1000).opacity).toBe(1);
    expect(at(2000).opacity).toBeGreaterThan(.4);
    expect(at(2800).opacity).toBeGreaterThan(.05);
    expect(at(2800).opacity).toBeLessThan(at(2000).opacity);
    expect(at(2999).opacity).toBeLessThan(.001);
    expect(at(3000).opacity).toBe(0);
    for (const boundary of [90, 1000, 2000, 2800]) {
      expect(Math.abs(at(boundary - .01).opacity - at(boundary + .01).opacity)).toBeLessThan(.001);
    }
  });

  it('enlarges the outer shock and actual blade body independently without changing the normal blade size', () => {
    const nearEnd = burstVisual(1440, 900, .5, .5, .999, 1, false);
    expect(nearEnd.radius / farCornerRadius(1440, 900, .5, .5)).toBeCloseTo(1.8, 6);
    const peak = burstVisual(1440, 900, .5, .5, .03, 1, false);
    const oldPeakBladeScale = 1 + .95 * Math.pow(.9, 1.2);
    expect(1 + peak.bladeExpansion).toBeCloseTo(oldPeakBladeScale * 1.5, 8);
    expect(burstVisual(1440, 900, .5, .5, 0, 1, false).bladeExpansion).toBe(0);
  });

  it('keeps an inner aftershock bounded by the shorter viewport side during the long tail', () => {
    for (const [x, y] of [[.5, .5], [0, 0], [1, 1]]) {
      for (const progress of [2 / 3, 2.8 / 3]) {
        const visual = burstVisual(1440, 900, x, y, progress, 1, false);
        expect(typeof visual.aftershockRadius).toBe('number');
        expect(visual.aftershockRadius).toBeGreaterThan(900 * .3);
        expect(visual.aftershockRadius).toBeLessThanOrEqual(900 * .45);
        expect(visual.aftershockRadius).toBeLessThan(visual.radius);
      }
    }
  });

  it('covers the farthest viewport corner before fading even at the weakest burst', () => {
    const width = 1440, height = 900, x = .08, y = .13;
    const visual = burstVisual(width, height, x, y, .65, .1, false);
    expect(visual.opacity).toBeGreaterThan(.05);
    for (const [cx, cy] of [[0, 0], [width, 0], [0, height], [width, height]]) {
      expect(visual.radius).toBeGreaterThanOrEqual(Math.hypot(cx - x * width, cy - y * height));
    }
  });

  it('returns no output at or after the burst end', () => {
    for (const progress of [1, 1.1, 20, -1]) {
      const visual = burstVisual(1440, 900, .5, .5, progress, 1, false);
      expect(visual.opacity).toBe(0);
      expect(visual.brightness).toBe(0);
      expect(visual.particles).toBe(0);
      expect(visual.radius).toBe(0);
      expect(visual.aftershockRadius).toBe(0);
      expect(visual.bladeExpansion).toBe(0);
    }
  });

  it('reduces motion, brightness and particle count while preserving shock reach', () => {
    const normal = burstVisual(1440, 900, .2, .8, .6, 1, false);
    const reduced = burstVisual(1440, 900, .2, .8, .6, 1, true);
    expect(reduced.radius).toBe(normal.radius);
    expect(reduced.aftershockRadius).toBe(normal.aftershockRadius);
    expect(reduced.opacity).toBeLessThan(normal.opacity);
    expect(reduced.brightness).toBeLessThan(normal.brightness);
    expect(reduced.particles).toBeLessThan(normal.particles);
    expect(reduced.bladeExpansion).toBeLessThan(normal.bladeExpansion);
    expect(reduced.motion).toBeLessThan(normal.motion);
  });

  it('keeps extreme and invalid envelope values finite and bounded', () => {
    for (const value of [NaN, Infinity, -Infinity, -20, 1e308, 0, .5, 1]) {
      const visual = burstVisual(value, value, value, value, value, value, false);
      expect(Object.values(visual).every(Number.isFinite)).toBe(true);
      expect(visual.opacity).toBeGreaterThanOrEqual(0);
      expect(visual.opacity).toBeLessThanOrEqual(1);
      expect(visual.particles).toBeLessThanOrEqual(76);
    }
    for (const value of [NaN, Infinity, -Infinity, -20, 1e308]) {
      const visual = burstVisual(value, value, value, value, .8, value, false);
      expect(Object.values(visual).every(Number.isFinite)).toBe(true);
      expect(typeof visual.aftershockRadius).toBe('number');
      expect(visual.aftershockRadius).toBeGreaterThanOrEqual(0);
      expect(visual.aftershockRadius).toBeLessThanOrEqual(450000);
    }
  });
});

// Record only the Canvas boundary; geometry, envelopes and both renderers remain real.
function recordingRenderer(width = 1440, height = 900) {
  type Operation = { name: string; args: unknown[]; fill: unknown; stroke: unknown; width: unknown; alpha: unknown };
  const operations: Operation[] = [];
  const stack: Record<string, unknown>[] = [];
  const context = new Proxy<Record<string, unknown>>({ globalAlpha: 1 }, {
    get(target, name: string) {
      if (name in target) return target[name];
      if (name === 'createRadialGradient' || name === 'createLinearGradient') return () => ({
        stops: [] as [number, string][],
        addColorStop(offset: number, color: string) { this.stops.push([offset, color]); },
      });
      return (...args: unknown[]) => {
        operations.push({ name, args, fill: target.fillStyle, stroke: target.strokeStyle, width: target.lineWidth, alpha: target.globalAlpha });
        if (name === 'save') stack.push({ ...target });
        if (name === 'restore') Object.assign(target, stack.pop());
      };
    },
    set(target, name: string, value) { target[name] = value; return true; },
  });
  const canvas = {
    width: 0, height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width, height }),
  };
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const renderer = new LightningRenderer(canvas as unknown as HTMLCanvasElement);
  operations.length = 0;
  return { renderer, operations, canvas, context: context as unknown as CanvasRenderingContext2D };
}

const wind: EffectSnapshot = { mode: 'shuriken', charge: 0, armed: false, burst: null, progress: 0, cooldown: 0 };

describe('shared Canvas renderer', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(['chidori', 'shuriken'] as const)('redistributes %s burst particles into the visible tail without exceeding existing budgets', (mode) => {
    const { renderer, operations } = recordingRenderer();
    renderer.cameraBackground = true;
    for (const reducedMotion of [false, true]) {
      renderer.reducedMotion = reducedMotion;
      operations.length = 0;
      renderer.render(3800, { x: .5, y: .5, expansion: 0 }, { ...wind, mode, progress: 2.8 / 3, burst: { id: 1, mode, strength: 1, startedAt: 1000 } });
      const radii = operations.flatMap((op, index) => {
        if (op.name !== 'stroke') return [];
        if (mode === 'chidori' && String(op.stroke).startsWith('rgba(208,242,255,')) {
          const point = operations[index - 2];
          return [Math.hypot(Number(point.args[0]), Number(point.args[1]))];
        }
        if (mode === 'shuriken' && String(op.stroke).startsWith('rgba(187,252,255,') && operations[index - 1]?.name === 'arc') return [Number(operations[index - 1].args[2])];
        return [];
      });
      const budget = reducedMotion ? Math.floor(76 * .28) : 76;
      expect(radii).toHaveLength(budget);
      expect(radii.filter(r => r <= 405).length).toBeGreaterThanOrEqual(Math.floor(budget * .7));
    }
    renderer.dispose();
  });

  it.each(['chidori', 'shuriken'] as const)('keeps actual %s aftershock rings on-screen at two and 2.8 seconds, including edge origins', (mode) => {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const { renderer, operations } = recordingRenderer(width, height);
      renderer.cameraBackground = true;
      const shortSide = Math.min(width, height);
      for (const [x, y] of [[.5, .5], [0, 0], [0, 1], [1, 0], [1, 1]]) {
        for (const reducedMotion of [false, true]) {
          renderer.reducedMotion = reducedMotion;
          renderer.setQuality(reducedMotion ? .5 : 1);
          for (const elapsed of [2000, 2800]) {
            operations.length = 0;
            renderer.render(1000 + elapsed, { x, y, expansion: 0 }, { ...wind, mode, progress: elapsed / 3000, burst: { id: 1, mode, strength: 1, startedAt: 1000 } });
            const pulse = burstVisual(width, height, x, y, elapsed / 3000, 1, reducedMotion);
            const rings = operations.filter((op, index) => op.name === 'arc' && op.args[0] === 0 && op.args[1] === 0 && op.args[3] === 0 && op.args[4] === Math.PI * 2 && operations[index + 1]?.name === 'stroke');
            const onScreenRings = rings.filter(op => {
              const r = Number(op.args[2]);
              return r > shortSide * .3 && r <= shortSide * .45 && Array.from({ length: 64 }, (_, i) => i * Math.PI / 32).some(a => {
                const px = x * width + Math.cos(a) * r, py = y * height + Math.sin(a) * r;
                return px > 0 && px < width && py > 0 && py < height;
              });
            });
            expect(onScreenRings.length).toBeGreaterThan(0);
            expect(onScreenRings.some(op => Number(op.args[2]) === pulse.aftershockRadius)).toBe(true);
            const innerRing = onScreenRings.find(op => Number(op.args[2]) === pulse.aftershockRadius)!;
            const innerStroke = operations[operations.indexOf(innerRing) + 1];
            expect(Number(String(innerStroke.stroke).match(/,([\d.]+)\)$/)?.[1])).toBeGreaterThan(0);
            const fullFrameFills = operations.filter(op => op.name === 'fillRect' && op.args.join(',') === `0,0,${width},${height}`);
            expect(fullFrameFills).toHaveLength(1); // Only the existing transparent blue wash over the camera.
            const wash = fullFrameFills[0].fill as { stops: [number, string][] };
            expect(wash.stops).toHaveLength(3);
            for (const [, color] of wash.stops) expect(Number(color.match(/,([\d.]+)\)$/)?.[1])).toBeLessThanOrEqual(.41);
            expect(wash.stops.at(-1)?.[1]).toBe('rgba(8,14,27,0)');
          }
        }
      }
      renderer.dispose();
    }
  });

  it('makes the rendered wind blade body 50% larger than the old peak, then returns exactly to normal', () => {
    const { renderer, operations } = recordingRenderer();
    const state = { x: .5, y: .5, expansion: .3 };
    const bladeTip = () => {
      const curve = operations.find(op => op.name === 'bezierCurveTo')!;
      return Math.hypot(Number(curve.args[4]), Number(curve.args[5]));
    };
    renderer.render(1000, state, wind);
    const normal = bladeTip();
    operations.length = 0;
    renderer.render(1000, state, { ...wind, progress: .03, burst: { id: 1, mode: 'shuriken', strength: 1, startedAt: 910 } });
    expect(bladeTip() / normal).toBeCloseTo((1 + .95 * Math.pow(.9, 1.2)) * 1.5, 8);
    operations.length = 0;
    renderer.render(1000, state, wind);
    expect(bladeTip()).toBeCloseTo(normal, 8);
    renderer.dispose();
  });

  it('generates exactly twenty deterministic lightning paths once per event, including a replacement during the tail', () => {
    const bolt = vi.spyOn(energy, 'generateBolt');
    const { renderer } = recordingRenderer();
    const render = (id: number, progress: number) => renderer.render(3000, { x: .5, y: .5, expansion: 0 }, { ...wind, mode: 'chidori', progress, burst: { id, mode: 'chidori', strength: 1, startedAt: 1000 } });
    const burstCalls = () => bolt.mock.calls.filter(call => Math.hypot(call[2], call[3]) <= 1);
    render(1, 2 / 3);
    expect(burstCalls()).toHaveLength(20);
    const firstSeeds = burstCalls().map(call => call[4]);
    expect(new Set(firstSeeds).size).toBe(20);
    renderer.reducedMotion = true;
    renderer.setQuality(.5);
    render(1, 2.8 / 3);
    expect(burstCalls()).toHaveLength(20);
    render(2, .03);
    expect(burstCalls()).toHaveLength(40);
    expect(burstCalls().slice(20).map(call => call[4])).not.toEqual(firstSeeds);
    renderer.dispose();
  });

  it('draws four curved wind blades on the same once-cleared canvas and switches cleanly back to lightning', () => {
    const { renderer, operations } = recordingRenderer();
    renderer.render(1000, { x: .5, y: .5, expansion: .3 }, wind);
    expect(operations.filter(op => op.name === 'bezierCurveTo').length).toBeGreaterThanOrEqual(12);
    expect(operations.filter(op => op.name === 'fillRect' && op.fill === '#080e1b')).toHaveLength(1);
    operations.length = 0;
    renderer.render(1016, { x: .5, y: .5, expansion: .3 });
    expect(operations.filter(op => op.name === 'bezierCurveTo')).toHaveLength(0);
    expect(operations.filter(op => op.name === 'fillRect' && op.fill === '#080e1b')).toHaveLength(1);
    renderer.dispose();
  });

  it.each(['chidori', 'shuriken'] as const)('adds a full-viewport %s shock without changing the continuous field', (mode) => {
    const { renderer, operations } = recordingRenderer();
    const state = Object.freeze({ x: .08, y: .13, expansion: 0 });
    renderer.render(1585, state, { ...wind, mode, progress: .65, burst: { id: 1, mode, strength: 1, startedAt: 1000 } });
    const shock = operations.filter(op => op.name === 'arc' && Number(op.args[2]) >= farCornerRadius(1440, 900, state.x, state.y));
    expect(shock.length).toBeGreaterThan(0);
    expect(state.expansion).toBe(0);
    renderer.dispose();
  });

  it('reduces wind drawing work when motion reduction and adaptive quality are enabled', () => {
    const { renderer, operations } = recordingRenderer();
    renderer.render(1000, { x: .5, y: .5, expansion: .3 }, wind);
    const normal = operations.length;
    operations.length = 0;
    renderer.reducedMotion = true;
    renderer.setQuality(.75);
    renderer.render(1016, { x: .5, y: .5, expansion: .3 }, wind);
    expect(operations.length).toBeLessThan(normal * .75);
    renderer.dispose();
  });

  it('clamps quality before resizing the backing canvas', () => {
    const { renderer, canvas } = recordingRenderer();
    renderer.setQuality(10);
    expect(canvas.width).toBe(1440);
    renderer.setQuality(NaN);
    expect(Number.isFinite(canvas.width)).toBe(true);
    renderer.dispose();
  });

  it('shows Chidori charge through thicker filaments without expanding the continuous field', () => {
    const { renderer, operations } = recordingRenderer();
    const state = Object.freeze({ x: .5, y: .5, expansion: .3 });
    renderer.render(1000, state, { ...wind, mode: 'chidori', charge: 0 });
    const baseline = Math.max(...operations.filter(op => op.name === 'stroke').map(op => Number(op.width)));
    operations.length = 0;
    renderer.render(1000, state, { ...wind, mode: 'chidori', charge: 1 });
    const charged = Math.max(...operations.filter(op => op.name === 'stroke').map(op => Number(op.width)));
    expect(charged).toBeGreaterThan(baseline);
    expect(state.expansion).toBe(.3);
    renderer.dispose();
  });

  it.each(['chidori', 'shuriken'] as const)('drops completed %s bursts with no extra full-screen flash layer', (mode) => {
    const { renderer, operations } = recordingRenderer();
    const state = { x: .2, y: .8, expansion: 0 };
    renderer.render(1900, state, { ...wind, mode, progress: 1, burst: { id: 2, mode, strength: 1, startedAt: 1000 } });
    expect(operations.filter(op => op.name === 'arc' && Number(op.args[2]) > 400)).toHaveLength(0);
    const fullFrameFills = operations.filter(op => op.name === 'fillRect' && op.args[0] === 0 && op.args[1] === 0 && op.args[2] === 1440 && op.args[3] === 900);
    expect(fullFrameFills).toHaveLength(2); // Existing dark background plus blue wash only.
    expect(operations.find(op => op.name === 'translate')?.args).toEqual([288, 720]);
    renderer.dispose();
  });

  it.each(['chidori', 'shuriken'] as const)('keeps active %s bursts free of full-screen flash fills', (mode) => {
    const { renderer, operations } = recordingRenderer();
    renderer.render(1180, { x: .5, y: .5, expansion: .2 }, { ...wind, mode, progress: .2, burst: { id: 3, mode, strength: 1, startedAt: 1000 } });
    const fills = operations.filter(op => op.name === 'fillRect' && op.args[0] === 0 && op.args[1] === 0 && op.args[2] === 1440 && op.args[3] === 900);
    expect(fills).toHaveLength(2);
    expect(fills[0].fill).toBe('#080e1b');
    renderer.dispose();
  });

  it('ignores an old burst that belongs to the other technique', () => {
    const { renderer, operations } = recordingRenderer();
    renderer.render(1585, { x: .1, y: .1, expansion: 0 }, { ...wind, progress: .65, burst: { id: 3, mode: 'chidori', strength: 1, startedAt: 1000 } });
    expect(operations.filter(op => op.name === 'arc' && Number(op.args[2]) > 400)).toHaveLength(0);
    renderer.dispose();
  });

  it('moves actual wind stream geometry smoothly through its first full blade rotation', () => {
    const { renderer, context, operations } = recordingRenderer();
    const windRenderer = new ShurikenRenderer();
    const frame = { radius: 200, core: 70, energy: 1, charge: 1, quality: 1, reducedMotion: false, burst: burstVisual(1440, 900, .5, .5, 1, 1, false) };
    let previous: number[] | null = null;
    for (let i = 0; i <= 84; i++) {
      operations.length = 0;
      windRenderer.render(context, i * 1000 / 60, frame);
      const point = operations.find(op => op.name === 'moveTo')!.args.map(Number);
      if (previous) expect(Math.hypot(point[0] - previous[0], point[1] - previous[1])).toBeLessThan(5);
      previous = point;
    }
    renderer.dispose();
  });
});

describe('fixed rendering budgets', () => {
  it('reduces population with quality and reduced motion, never above capacity', () => {
    expect(visualParticleCount(150, 1, false)).toBe(150);
    expect(visualParticleCount(150, .75, false)).toBeLessThan(150);
    expect(visualParticleCount(150, 1, true)).toBeLessThan(75);
    expect(visualParticleCount(150, 100, false)).toBe(150);
    expect(visualParticleCount(150, NaN, false)).toBe(0);
  });
});
