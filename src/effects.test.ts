import { describe, expect, it } from 'vitest';
import { EffectController } from './effects';
import type { GestureReading } from './gesture';

const hand = (openness: number, handCount = 1, expansion = openness): GestureReading => ({
  x: 0.5, y: 0.5, openness, expansion, handCount,
});

function arm(controller: EffectController, now = 0, handCount = 1) {
  controller.observe(hand(0.1, handCount), now);
  controller.observe(hand(0.1, handCount), now + 150);
  controller.observe(hand(0.1, handCount), now + 300);
}

function releaseGesture(controller: EffectController, now: number, reading = hand(1)) {
  expect(controller.observe(reading, now)).toBeNull();
  return controller.observe(reading, now + 160);
}

describe('EffectController', () => {
  it('starts with a finite, idle chidori snapshot', () => {
    expect(new EffectController().snapshot(0)).toEqual({
      mode: 'chidori', charge: 0, armed: false, burst: null, progress: 0, cooldown: 0,
    });
  });

  it.each(['chidori', 'shuriken'] as const)('keeps a full-strength %s burst for exactly 3000ms', (mode) => {
    const effects = new EffectController();
    effects.setMode(mode);
    expect(effects.trigger(100)).toEqual({ id: 1, mode, strength: 1, startedAt: 100 });
    expect(effects.snapshot(1100).cooldown).toBe(0);
    expect(effects.snapshot(1600)).toMatchObject({ progress: 0.5, cooldown: 0 });
    expect(effects.snapshot(3099).burst?.id).toBe(1);
    expect(effects.snapshot(3100)).toMatchObject({ burst: null, progress: 0, cooldown: 0 });
  });

  it.each(['chidori', 'shuriken'] as const)('replaces an active %s burst at 1000ms with a fresh three-second lifetime', (mode) => {
    const effects = new EffectController();
    effects.setMode(mode);
    effects.trigger(0);
    expect(effects.trigger(999)).toBeNull();
    expect(effects.snapshot(999).burst?.id).toBe(1);
    expect(effects.trigger(1000)).toMatchObject({ id: 2, mode, startedAt: 1000 });
    expect(effects.snapshot(1000)).toMatchObject({ progress: 0, cooldown: 1000 });
    expect(effects.snapshot(3000)).toMatchObject({ burst: { id: 2 }, progress: 2 / 3 });
    expect(effects.snapshot(3999).burst?.id).toBe(2);
    expect(effects.snapshot(4000).burst).toBeNull();
  });

  it('cancels the long tail immediately without creating a replacement', () => {
    const effects = new EffectController();
    effects.trigger(0);
    expect(effects.snapshot(2800).burst?.id).toBe(1);
    effects.cancel();
    expect(effects.snapshot(2800)).toMatchObject({ burst: null, progress: 0, charge: 0, armed: false });
  });

  it('rejects bursts until the exact 1000ms cooldown boundary', () => {
    const effects = new EffectController();
    effects.trigger(0);
    expect(effects.trigger(999)).toBeNull();
    expect(effects.trigger(1000)?.id).toBe(2);
  });

  it('clamps finite burst strength to the .35..1 range', () => {
    const effects = new EffectController();
    expect(effects.trigger(0, -10)?.strength).toBe(0.35);
    expect(effects.trigger(1000, 10)?.strength).toBe(1);
    expect(effects.trigger(2000, 0.62)?.strength).toBe(0.62);
  });

  it('allows a quick pointer tap and ramps longer charges', () => {
    const effects = new EffectController();
    effects.beginCharge(0);
    expect(effects.release(0)?.strength).toBe(0.35);
    effects.beginCharge(1000);
    expect(effects.snapshot(1500).charge).toBe(0.5);
    expect(effects.release(1500)?.strength).toBeCloseTo(0.675);
    effects.beginCharge(2500);
    expect(effects.release(5000)?.strength).toBe(1);
  });

  it('does not reset a pointer hold on repeated begin calls', () => {
    const effects = new EffectController();
    effects.beginCharge(100);
    effects.beginCharge(600);
    expect(effects.release(1100)?.strength).toBe(1);
  });

  it('never releases without a pending pointer charge', () => {
    const effects = new EffectController();
    expect(effects.release(0)).toBeNull();
    arm(effects, 100);
    expect(effects.release(400)).toBeNull();
  });

  it('consumes pointer charge when cooldown rejects a release', () => {
    const effects = new EffectController();
    effects.trigger(0);
    effects.beginCharge(100);
    expect(effects.release(200)).toBeNull();
    expect(effects.snapshot(200).charge).toBe(0);
    expect(effects.release(1000)).toBeNull();
  });

  it('cancels active effects and charge but preserves cooldown and event ids', () => {
    const effects = new EffectController();
    effects.trigger(0);
    effects.beginCharge(10);
    effects.cancel();
    expect(effects.snapshot(100)).toMatchObject({ charge: 0, armed: false, burst: null, cooldown: 900 });
    expect(effects.release(100)).toBeNull();
    expect(effects.trigger(999)).toBeNull();
    expect(effects.trigger(1000)?.id).toBe(2);
  });

  it('switches modes without resetting cooldown or event ids', () => {
    const effects = new EffectController();
    effects.trigger(0);
    effects.beginCharge(10);
    effects.setMode('shuriken');
    expect(effects.snapshot(100)).toMatchObject({ mode: 'shuriken', charge: 0, armed: false, burst: null, cooldown: 900 });
    expect(effects.trigger(999)).toBeNull();
    expect(effects.trigger(1000)).toMatchObject({ id: 2, mode: 'shuriken' });
  });

  it('treats selecting the current mode as a no-op', () => {
    const effects = new EffectController();
    effects.beginCharge(0);
    effects.setMode('chidori');
    expect(effects.release(500)?.strength).toBeCloseTo(0.675);
    effects.setMode('chidori');
    expect(effects.snapshot(501).burst?.id).toBe(1);
  });

  it('arms at inclusive single-hand thresholds after 300ms of continuous low samples', () => {
    const effects = new EffectController();
    effects.observe(hand(0.22), 0);
    effects.observe(hand(0.22), 299);
    expect(effects.snapshot(299).armed).toBe(false);
    effects.observe(hand(0.22), 300);
    expect(effects.snapshot(300)).toMatchObject({ charge: 1, armed: true });
    const event = releaseGesture(effects, 301, hand(0.72));
    expect(event?.id).toBe(1);
    expect(event?.strength).toBeCloseTo(0.64965);
    expect(effects.snapshot(461)).toMatchObject({ charge: 0, armed: false });
  });

  it('uses expansion, not openness, for two-hand arming and release', () => {
    const effects = new EffectController();
    effects.observe(hand(1, 2, 0.18), 0);
    effects.observe(hand(1, 2, 0.18), 300);
    expect(effects.observe(hand(0, 2, 0.779), 301)).toBeNull();
    expect(releaseGesture(effects, 302, hand(0, 2, 0.78))?.id).toBe(1);
  });

  it.each([1, 2])('increases %i-hand burst strength from a 300ms arm to a 1000ms hold', (handCount) => {
    const quick = new EffectController();
    arm(quick, 0, handCount);
    const quickBurst = releaseGesture(quick, 300, hand(1, handCount))!;

    const full = new EffectController();
    arm(full, 0, handCount);
    for (const now of [500, 750, 1000]) full.observe(hand(0.1, handCount), now);
    const fullBurst = releaseGesture(full, 1000, hand(1, handCount))!;

    expect(quickBurst.strength).toBeCloseTo(0.649);
    expect(quickBurst.strength).toBeGreaterThanOrEqual(0.35);
    expect(quickBurst.strength).toBeLessThan(fullBurst.strength);
    expect(fullBurst.strength).toBe(1);
  });

  it('continues gesture strength timing through armed intermediate samples', () => {
    const effects = new EffectController();
    arm(effects);
    effects.observe(hand(0.5), 450);
    expect(releaseGesture(effects, 600)?.strength).toBeCloseTo(0.844);
  });

  it('caps gesture strength after holds longer than 1000ms', () => {
    const effects = new EffectController();
    arm(effects);
    for (const now of [600, 900, 1200, 1500]) effects.observe(hand(0.5), now);
    expect(releaseGesture(effects, 1500)?.strength).toBe(1);
  });

  it('resets continuous-low timing on intermediate jitter before arming', () => {
    const effects = new EffectController();
    effects.observe(hand(0.1), 0);
    effects.observe(hand(0.23), 200);
    effects.observe(hand(0.1), 250);
    effects.observe(hand(0.1), 400);
    expect(effects.observe(hand(0.9), 500)).toBeNull();
    expect(effects.snapshot(500).armed).toBe(false);
  });

  it('retains an armed gesture through intermediate values', () => {
    const effects = new EffectController();
    arm(effects);
    effects.observe(hand(0.5), 400);
    effects.observe(hand(0.71), 500);
    expect(effects.snapshot(500).armed).toBe(true);
    expect(releaseGesture(effects, 600, hand(0.72))?.id).toBe(1);
  });

  it('does not repeat while the hand stays high beyond cooldown', () => {
    const effects = new EffectController();
    arm(effects);
    expect(releaseGesture(effects, 310)?.id).toBe(1);
    for (const now of [500, 800, 1100, 1400, 1700]) {
      expect(effects.observe(hand(1), now)).toBeNull();
    }
    arm(effects, 1800);
    expect(releaseGesture(effects, 2110)?.id).toBe(2);
  });

  it('consumes a gesture release rejected by cooldown', () => {
    const effects = new EffectController();
    effects.trigger(0);
    arm(effects, 100);
    expect(releaseGesture(effects, 410)).toBeNull();
    expect(effects.snapshot(570)).toMatchObject({ charge: 0, armed: false });
    expect(effects.observe(hand(1), 1000)).toBeNull();
  });

  it('disarms when the hand count changes', () => {
    const effects = new EffectController();
    arm(effects);
    expect(effects.observe(hand(1, 2), 310)).toBeNull();
    expect(effects.snapshot(310).armed).toBe(false);
  });

  it('breaks unarmed continuous-low dwell on a null sample', () => {
    const effects = new EffectController();
    effects.observe(hand(0.1), 0);
    effects.observe(null, 200);
    effects.observe(hand(0.1), 300);
    expect(effects.observe(hand(1), 350)).toBeNull();
  });

  it('allows brief tracking loss for an armed pose but rejects gaps over 350ms', () => {
    const shortGap = new EffectController();
    arm(shortGap);
    shortGap.observe(null, 400);
    expect(releaseGesture(shortGap, 650)?.id).toBe(1);

    const longGap = new EffectController();
    arm(longGap);
    longGap.observe(null, 500);
    expect(longGap.observe(hand(1), 651)).toBeNull();
    expect(longGap.snapshot(651).armed).toBe(false);
  });

  it('expires stale gesture arming in snapshot even without more camera samples', () => {
    const effects = new EffectController();
    arm(effects);
    expect(effects.snapshot(650).armed).toBe(true);
    expect(effects.snapshot(651)).toMatchObject({ charge: 0, armed: false });
    expect(effects.observe(hand(1), 652)).toBeNull();
  });

  it('rejects a transient single-open frame while a second hand appears', () => {
    const effects = new EffectController();
    arm(effects);
    expect(effects.observe(hand(1), 400)).toBeNull();
    expect(effects.observe(hand(1, 2), 506)).toBeNull();
    expect(effects.observe(hand(1, 2), 666)).toBeNull();
    expect(effects.snapshot(666)).toMatchObject({ armed: false, burst: null });
  });

  it.each([1, 2])('requires two stable %i-hand high samples spanning at least 160ms', (handCount) => {
    const effects = new EffectController();
    arm(effects, 0, handCount);
    expect(effects.observe(hand(1, handCount), 400)).toBeNull();
    expect(effects.observe(hand(1, handCount), 559)).toBeNull();
    expect(effects.observe(hand(1, handCount), 560)).toMatchObject({ id: 1, startedAt: 560 });
    expect(effects.observe(hand(1, handCount), 720)).toBeNull();
  });

  it('does not release from one high frame even when a later snapshot spans the dwell', () => {
    const effects = new EffectController();
    arm(effects);
    expect(effects.observe(hand(1), 400)).toBeNull();
    expect(effects.snapshot(560)).toMatchObject({ armed: true, burst: null });
    expect(effects.observe(hand(1), 560)?.id).toBe(1);
  });

  it.each([hand(0.1), hand(0.5), null])('restarts high dwell after low/intermediate/missing data %j', (reading) => {
    const effects = new EffectController();
    arm(effects);
    expect(effects.observe(hand(1), 400)).toBeNull();
    expect(effects.observe(reading, 450)).toBeNull();
    expect(effects.observe(hand(1), 560)).toBeNull();
    expect(effects.observe(hand(1), 719)).toBeNull();
    expect(effects.observe(hand(1), 720)?.id).toBe(1);
  });

  it('does not expire pointer charge when tracking is absent', () => {
    const effects = new EffectController();
    effects.beginCharge(0);
    effects.observe(null, 500);
    expect(effects.snapshot(2000)).toMatchObject({ charge: 1, armed: true });
    expect(effects.release(2000)?.strength).toBe(1);
  });

  it('manual accepted bursts consume both gesture and pointer charge', () => {
    const effects = new EffectController();
    arm(effects);
    effects.beginCharge(300);
    effects.trigger(301);
    expect(effects.snapshot(301)).toMatchObject({ charge: 0, armed: false });
    expect(effects.release(1400)).toBeNull();
    expect(effects.observe(hand(1), 1400)).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])('rejects invalid timestamp %s without poisoning snapshots', (now) => {
    const effects = new EffectController();
    effects.beginCharge(now);
    expect(effects.release(now)).toBeNull();
    expect(effects.trigger(now)).toBeNull();
    expect(effects.observe(hand(0.1), now)).toBeNull();
    const snapshot = effects.snapshot(now);
    expect(snapshot).toMatchObject({ charge: 0, armed: false, burst: null, progress: 0, cooldown: 0 });
    expect([snapshot.charge, snapshot.progress, snapshot.cooldown].every(Number.isFinite)).toBe(true);
    expect(effects.trigger(0)?.id).toBe(1);
  });

  it('rejects nonmonotonic event times and consumes an invalid pointer release', () => {
    const effects = new EffectController();
    effects.beginCharge(100);
    effects.snapshot(200);
    expect(effects.release(150)).toBeNull();
    expect(effects.release(300)).toBeNull();
    expect(effects.trigger(199)).toBeNull();
    expect(effects.trigger(300)?.id).toBe(1);
    expect(effects.snapshot(250)).toMatchObject({ progress: 0, cooldown: 1000 });
  });

  it('does not let invalid or backward gesture samples preserve pending arming', () => {
    for (const invalidNow of [Number.NaN, -1, 299]) {
      const effects = new EffectController();
      arm(effects);
      expect(effects.observe(hand(1), invalidNow)).toBeNull();
      expect(effects.observe(hand(1), 400)).toBeNull();
    }
  });

  it.each([
    { openness: Number.NaN }, { expansion: Number.POSITIVE_INFINITY }, { x: Number.NaN },
    { y: -1 }, { openness: 1.1 }, { expansion: -0.1 }, { handCount: 0 }, { handCount: 3 }, { handCount: 1.5 },
  ])('rejects invalid gesture data %j and clears its pending pose', (invalid) => {
    const effects = new EffectController();
    arm(effects);
    expect(effects.observe({ ...hand(1), ...invalid }, 310)).toBeNull();
    expect(effects.observe(hand(1), 320)).toBeNull();
    expect(effects.snapshot(320)).toMatchObject({ charge: 0, armed: false });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects nonfinite strength %s without consuming an id', (strength) => {
    const effects = new EffectController();
    expect(effects.trigger(0, strength)).toBeNull();
    expect(effects.trigger(0)?.id).toBe(1);
  });

  it('does not expose mutable internal burst records', () => {
    const effects = new EffectController();
    const event = effects.trigger(0)!;
    event.strength = Number.NaN;
    event.startedAt = -1000;
    const snapshot = effects.snapshot(100);
    expect(snapshot.burst).toMatchObject({ strength: 1, startedAt: 0 });
    snapshot.burst!.id = 100;
    expect(effects.snapshot(100).burst?.id).toBe(1);
  });
});
