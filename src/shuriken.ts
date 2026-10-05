import { advanceShurikenPhase, shurikenBlades, visualParticleCount, type BurstVisual } from './effect-visuals';

const TAU = Math.PI * 2;

interface WindFrame {
  radius: number;
  core: number;
  energy: number;
  charge: number;
  quality: number;
  reducedMotion: boolean;
  burst: BurstVisual;
}

/**
 * Woven Vortex: four coherent pressure fronts orbit a tightly interlaced sphere.
 * The silhouette stays readable while nested curves reveal the rotating flow.
 *
 * Quarter-turn geometry supplies order; deterministic phase offsets give the
 * surrounding air a softer, asymmetric texture without frame-to-frame noise.
 *
 * Energy changes velocity and reach, never the accumulated angle. The core's
 * projected meridians and wind trails belong to that same continuous field.
 *
 * Finite drawing budgets preserve the hierarchy: blade, sphere, then motes.
 * A burst is a fading radial pressure wave, not a white flash over the scene.
 */
export class ShurikenRenderer {
  private phase = .2;
  private previousTime: number | null = null;

  /** Draw in the caller's translated Canvas; never clear, resize or allocate particles. */
  render(ctx: CanvasRenderingContext2D, time: number, frame: WindFrame) {
    const dt = this.previousTime === null ? 0 : (time - this.previousTime) / 1000;
    this.previousTime = time;
    const { energy, charge, quality, reducedMotion, burst } = frame;
    this.phase = advanceShurikenPhase(this.phase, dt, energy, charge, reducedMotion);
    const phase = this.phase;
    const radius = Math.max(frame.core * 1.95, frame.radius * .96) * (1 + burst.bladeExpansion);
    const core = Math.min(radius * .28, frame.core * .76) * (1 + charge * .12 + burst.bladeExpansion * .16);
    const light = reducedMotion ? .64 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = light;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, core * 3.1);
    halo.addColorStop(0, `rgba(183,251,255,${.2 + charge * .1})`);
    halo.addColorStop(.35, 'rgba(72,214,245,.16)');
    halo.addColorStop(1, 'rgba(9,125,190,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(-core * 3.1, -core * 3.1, core * 6.2, core * 6.2);

    // Fine spiral traces sit behind the broad blades, preserving their silhouette.
    const streams = visualParticleCount(16, quality, reducedMotion);
    const samples = reducedMotion ? 20 : 32;
    for (let i = 0; i < streams; i++) {
      const offset = i * TAU / Math.max(streams, 1) + phase * .75;
      ctx.beginPath();
      for (let j = 0; j <= samples; j++) {
        const u = j / samples, a = offset + u * 1.45;
        const r = radius * (.28 + u * (.8 + (i % 3) * .04));
        const px = Math.cos(a) * r, py = Math.sin(a) * r * .92;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = `rgba(99,228,248,${i % 3 ? .12 : .25})`;
      ctx.lineWidth = i % 3 ? .65 : 1.25; ctx.stroke();
    }

    const bladeFill = ctx.createRadialGradient(0, 0, core * .35, 0, 0, radius * 1.05);
    bladeFill.addColorStop(0, 'rgba(132,245,255,.05)');
    bladeFill.addColorStop(.3, 'rgba(114,227,248,.2)');
    bladeFill.addColorStop(.62, 'rgba(188,250,255,.41)');
    bladeFill.addColorStop(1, 'rgba(228,255,255,.72)');
    for (const blade of shurikenBlades(radius, phase)) {
      ctx.beginPath(); ctx.moveTo(blade[0].x, blade[0].y);
      for (let i = 1; i < blade.length; i += 3) {
        ctx.bezierCurveTo(blade[i].x, blade[i].y, blade[i + 1].x, blade[i + 1].y, blade[i + 2].x, blade[i + 2].y);
      }
      ctx.closePath(); ctx.fillStyle = bladeFill; ctx.fill();
      ctx.strokeStyle = 'rgba(64,207,251,.12)'; ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = 'rgba(187,252,255,.74)'; ctx.lineWidth = 1.1 + charge * .65; ctx.stroke();
      // A white cutting edge occupies only the leading side, not the entire blade.
      ctx.beginPath(); ctx.moveTo(blade[0].x, blade[0].y);
      ctx.bezierCurveTo(blade[1].x, blade[1].y, blade[2].x, blade[2].y, blade[3].x, blade[3].y);
      ctx.strokeStyle = 'rgba(235,255,255,.84)'; ctx.lineWidth = 1.6; ctx.stroke();
    }

    // Projected great circles make a spherical weave rather than a flat disc.
    const loops = reducedMotion ? 11 : Math.round(22 * quality);
    const coreSamples = reducedMotion ? 40 : 64;
    for (let i = 0; i < loops; i++) {
      const tilt = i * 2.39996 + phase * .3;
      const c = Math.cos(tilt), s = Math.sin(tilt);
      const flatten = .18 + .72 * Math.abs(Math.sin(i * .63 + phase * .2));
      ctx.beginPath();
      for (let j = 0; j <= coreSamples; j++) {
        const a = j / coreSamples * TAU;
        const weave = 1 + Math.sin(a * 7 + i * 1.7 + phase) * .035;
        const px = Math.cos(a) * core * weave, py = Math.sin(a) * core * flatten * weave;
        const x = px * c - py * s, y = px * s + py * c;
        if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = i % 3 ? 'rgba(131,239,255,.51)' : 'rgba(225,255,255,.85)';
      ctx.lineWidth = i % 3 ? .85 : 1.4; ctx.stroke();
    }
    const center = ctx.createRadialGradient(0, 0, 0, 0, 0, core);
    center.addColorStop(0, 'rgba(222,255,255,.65)');
    center.addColorStop(.27, 'rgba(117,239,255,.27)');
    center.addColorStop(1, 'rgba(51,185,235,0)');
    ctx.fillStyle = center; ctx.fillRect(-core, -core, core * 2, core * 2);

    const particles = visualParticleCount(104, quality, reducedMotion);
    for (let i = 0; i < particles; i++) {
      const orbit = .36 + ((i * 37) % 100) / 100 * .84;
      const angle = i * 2.39996 + phase * (.35 + (i % 5) * .13);
      const r = radius * orbit, x = Math.cos(angle) * r, y = Math.sin(angle) * r * .92;
      ctx.strokeStyle = `rgba(161,244,255,${.13 + (i % 7) * .055})`;
      ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(x, y);
      const tail = reducedMotion ? .013 : .035 + charge * .018;
      ctx.lineTo(Math.cos(angle - tail) * r, Math.sin(angle - tail) * r * .92); ctx.stroke();
    }

    if (burst.opacity > 0) {
      ctx.globalAlpha = 1; // The burst envelope already includes reduced-motion attenuation.
      const rings = reducedMotion ? 1 : 3;
      for (let i = 0; i < rings; i++) {
        ctx.beginPath(); ctx.arc(0, 0, burst.radius * (1 - i * .065), 0, TAU);
        ctx.strokeStyle = `rgba(165,247,255,${burst.opacity * (i ? .3 : .8)})`;
        ctx.lineWidth = i ? 1 : 2.5 + burst.brightness * 4; ctx.stroke();
      }
      // A second, viewport-bounded pressure front carries the long fading tail.
      for (let i = 0; i < (reducedMotion ? 1 : 2); i++) {
        ctx.beginPath(); ctx.arc(0, 0, burst.aftershockRadius * (1 - i * .2), 0, TAU);
        ctx.strokeStyle = `rgba(165,247,255,${burst.opacity * (i ? .3 : .8)})`;
        ctx.lineWidth = i ? 1 : 2 + burst.brightness * 3; ctx.stroke();
      }
      const cuttingTrails = visualParticleCount(burst.particles, quality, false);
      for (let i = 0; i < cuttingTrails; i++) {
        const a = i * 2.39996 + phase * .25;
        const reach = i % 4 ? burst.aftershockRadius : burst.radius;
        const r = reach * (.32 + ((i * 29) % 100) / 100 * .66);
        const sweep = (.05 + (i % 4) * .035) * burst.motion;
        ctx.beginPath(); ctx.arc(0, 0, r, a - sweep, a + sweep);
        ctx.strokeStyle = `rgba(187,252,255,${burst.opacity * (.22 + (i % 3) * .14)})`;
        ctx.lineWidth = i % 6 ? .9 : 2; ctx.stroke();
      }
    }
    ctx.restore();
  }
}
