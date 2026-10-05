import type { GestureReading } from './gesture';

export type EffectMode = 'chidori' | 'shuriken';

export interface BurstEvent {
  id: number;
  mode: EffectMode;
  strength: number;
  startedAt: number;
}

export interface EffectSnapshot {
  mode: EffectMode;
  charge: number;
  armed: boolean;
  burst: BurstEvent | null;
  progress: number;
  cooldown: number;
}

const BURST_DURATION_MS = 3000;
const COOLDOWN_MS = 1000;
const FULL_CHARGE_MS = 1000;
const GESTURE_ARM_MS = 300;
const GESTURE_RELEASE_MS = 160;
const TRACKING_GRACE_MS = 350;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function validReading(reading: GestureReading): boolean {
  return (reading.handCount === 1 || reading.handCount === 2)
    && [reading.x, reading.y, reading.openness, reading.expansion]
      .every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

/** Pure state machine; all times are monotonic performance.now() milliseconds. */
export class EffectController {
  private mode: EffectMode = 'chidori';
  private lastTime = 0;
  private nextId = 1;
  private burst: BurstEvent | null = null;
  private lastBurstAt: number | null = null;
  private pointerStartedAt: number | null = null;
  private lowStartedAt: number | null = null;
  private highStartedAt: number | null = null;
  private gestureArmed = false;
  private handCount: number | null = null;
  private lastReadingAt: number | null = null;

  setMode(mode: EffectMode): void {
    if ((mode !== 'chidori' && mode !== 'shuriken') || mode === this.mode) return;
    this.mode = mode;
    this.cancel();
  }

  beginCharge(now: number): void {
    if (!this.advance(now)) return;
    this.pointerStartedAt ??= now;
  }

  release(now: number): BurstEvent | null {
    const startedAt = this.pointerStartedAt;
    this.pointerStartedAt = null;
    if (!this.advance(now) || startedAt === null) return null;
    // A release is consumed even during cooldown; it is never queued.
    this.resetGesture();
    return this.trigger(now, 0.35 + 0.65 * clamp((now - startedAt) / FULL_CHARGE_MS));
  }

  trigger(now: number, strength = 1): BurstEvent | null {
    if (!this.advance(now) || !Number.isFinite(strength) || this.cooldown(now) > 0) return null;
    this.clearCharge();
    this.lastBurstAt = now;
    this.burst = { id: this.nextId++, mode: this.mode, strength: Math.max(0.35, Math.min(1, strength)), startedAt: now };
    return { ...this.burst };
  }

  observe(reading: GestureReading | null, now: number): BurstEvent | null {
    if (!this.advance(now)) {
      this.resetGesture();
      return null;
    }
    if (reading === null) {
      // Missing frames cannot count as a continuous low hold. An already
      // armed pose has only the grace period since its last valid sample.
      if (!this.gestureArmed) this.lowStartedAt = null;
      this.highStartedAt = null;
      return null;
    }
    if (!validReading(reading)) {
      this.resetGesture();
      return null;
    }
    if (this.handCount !== reading.handCount) this.resetGesture();
    this.handCount = reading.handCount;
    this.lastReadingAt = now;

    const value = reading.handCount === 1 ? reading.openness : reading.expansion;
    const low = reading.handCount === 1 ? 0.22 : 0.18;
    const high = reading.handCount === 1 ? 0.72 : 0.78;
    if (value <= low) {
      this.highStartedAt = null;
      this.lowStartedAt ??= now;
      if (now - this.lowStartedAt >= GESTURE_ARM_MS) this.gestureArmed = true;
    } else if (this.gestureArmed && value >= high) {
      // A transition can briefly look like a single open hand while the
      // second hand is entering tracking. Require a stable high-pose dwell.
      if (this.highStartedAt === null) {
        this.highStartedAt = now;
        return null;
      }
      if (now - this.highStartedAt < GESTURE_RELEASE_MS) return null;
      // Keep the original low-pose start through armed intermediate values,
      // and capture its strength before consuming the pending gesture.
      const strength = 0.35 + 0.65 * clamp((now - (this.lowStartedAt ?? now)) / FULL_CHARGE_MS);
      this.clearCharge();
      return this.trigger(now, strength);
    } else {
      this.highStartedAt = null;
      if (!this.gestureArmed) this.lowStartedAt = null;
    }
    return null;
  }

  cancel(): void {
    this.clearCharge();
    this.burst = null;
  }

  snapshot(now: number): EffectSnapshot {
    // A malformed or backward read returns the last valid state; it cannot
    // make progress/cooldown negative or resurrect an expired pose.
    this.advance(now);
    const pointerCharge = this.pointerStartedAt === null ? 0 : clamp((this.lastTime - this.pointerStartedAt) / FULL_CHARGE_MS);
    const gestureCharge = this.gestureArmed ? 1 : this.lowStartedAt === null ? 0 : clamp((this.lastTime - this.lowStartedAt) / GESTURE_ARM_MS);
    return {
      mode: this.mode,
      charge: Math.max(pointerCharge, gestureCharge),
      armed: this.pointerStartedAt !== null || this.gestureArmed,
      burst: this.burst ? { ...this.burst } : null,
      progress: this.burst ? clamp((this.lastTime - this.burst.startedAt) / BURST_DURATION_MS) : 0,
      cooldown: this.cooldown(this.lastTime),
    };
  }

  private advance(now: number): boolean {
    if (!Number.isFinite(now) || now < 0 || now < this.lastTime) return false;
    this.lastTime = now;
    if (this.burst && now - this.burst.startedAt >= BURST_DURATION_MS) this.burst = null;
    if (this.lastReadingAt !== null && now - this.lastReadingAt > TRACKING_GRACE_MS) this.resetGesture();
    return true;
  }

  private cooldown(now: number): number {
    return this.lastBurstAt === null ? 0 : Math.max(0, COOLDOWN_MS - (now - this.lastBurstAt));
  }

  private resetGesture(): void {
    this.lowStartedAt = null;
    this.highStartedAt = null;
    this.gestureArmed = false;
    this.handCount = null;
    this.lastReadingAt = null;
  }

  private clearCharge(): void {
    this.pointerStartedAt = null;
    this.resetGesture();
  }
}
