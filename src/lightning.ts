import { clamp, coverageRadius, generateBolt, type EnergyState, type Point } from './energy';
import type { BurstEvent, EffectSnapshot } from './effects';
import { burstVisual, visualParticleCount, type BurstVisual } from './effect-visuals';
import { ShurikenRenderer } from './shuriken';

/** Layered 2D plasma with projected orbital filaments; no textures or remote assets. */
export class LightningRenderer {
  private context: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private observer: ResizeObserver;
  private dust = Array.from({ length: 150 }, (_, i) => ({
    angle: i * 2.39996, orbit: .22 + ((i * 73) % 100) / 100,
    speed: .07 + ((i * 17) % 30) / 160, size: .6 + (i % 4) * .45,
  }));
  private arcCache: { tick: number; radius: number; paths: Point[][] } = { tick: -1, radius: -1, paths: [] };
  private burstCache: { id: number; paths: Point[][] } = { id: -1, paths: [] };
  private wind = new ShurikenRenderer();
  reducedMotion = false;
  quality = 1;
  cameraBackground = false;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('浏览器不支持 Canvas，请使用新版 Chrome 或 Edge。');
    this.context = context;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width; this.height = rect.height;
    const ratio = Math.min(devicePixelRatio || 1, 1.5) * this.quality;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  setQuality(value: number) {
    if (!Number.isFinite(value)) return;
    value = clamp(value, .5, 1);
    if (value === this.quality) return;
    this.quality = value; this.resize();
  }

  render(time: number, state: EnergyState, effect?: EffectSnapshot) {
    const ctx = this.context, w = this.width, h = this.height;
    if (!w || !h) return;
    const t = time * (this.reducedMotion ? .00015 : .001);
    const e = state.expansion, x = state.x * w, y = state.y * h;
    const radius = coverageRadius(w, h, state.x, state.y, e);
    const core = Math.min(w * .11, 76 + e * 38);
    const charge = clamp(effect?.charge ?? 0);
    const burst = effect?.burst && effect.burst.mode === effect.mode ? effect.burst : null;
    const pulse = burstVisual(w, h, state.x, state.y, burst ? effect!.progress : 1, burst?.strength ?? 0, this.reducedMotion);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (this.cameraBackground) ctx.clearRect(0, 0, w, h);
    else { ctx.fillStyle = '#080e1b'; ctx.fillRect(0, 0, w, h); }

    const wash = ctx.createRadialGradient(x, y, 0, x, y, Math.max(350, radius * 1.3));
    wash.addColorStop(0, `rgba(18,70,124,${.29 + e * .12})`);
    wash.addColorStop(.4, 'rgba(10,33,66,.22)'); wash.addColorStop(1, 'rgba(8,14,27,0)');
    ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);

    // A quiet dot field grounds the energy in a spatial measuring surface.
    if (!this.cameraBackground) {
      ctx.fillStyle = 'rgba(110,155,200,.13)';
      for (let px = 30; px < w; px += 36) for (let py = 12; py < h; py += 36) ctx.fillRect(px, py, 1, 1);
    }
    ctx.save(); ctx.translate(x, y);

    if (!this.cameraBackground) {
      ctx.strokeStyle = 'rgba(87,151,206,.12)'; ctx.lineWidth = .8;
      for (const r of [164, 240, 314]) {
        ctx.beginPath(); ctx.arc(0, 0, r * Math.min(w / 1000, 1), 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = 0; i < 60; i++) {
        const angle = i * Math.PI / 30, r = 314 * Math.min(w / 1000, 1);
        ctx.strokeStyle = i % 5 ? 'rgba(104,150,196,.12)' : 'rgba(123,183,236,.3)';
        ctx.beginPath(); ctx.moveTo(Math.cos(angle)*r, Math.sin(angle)*r);
        ctx.lineTo(Math.cos(angle)*(r+(i%5?4:8)), Math.sin(angle)*(r+(i%5?4:8))); ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    if (effect?.mode === 'shuriken') {
      this.wind.render(ctx, time, { radius, core, energy: e, charge, quality: this.quality, reducedMotion: this.reducedMotion, burst: pulse });
      ctx.restore(); ctx.globalCompositeOperation = 'source-over';
      return;
    }
    ctx.globalAlpha = this.reducedMotion ? .7 : 1;
    const glow = ctx.createRadialGradient(0, 0, core * .1, 0, 0, core * 3.4);
    glow.addColorStop(0, 'rgba(111,205,255,.21)'); glow.addColorStop(.3, 'rgba(37,132,255,.19)');
    glow.addColorStop(.6, 'rgba(21,88,251,.07)'); glow.addColorStop(1, 'rgba(0,50,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(-core*3.4,-core*3.4,core*6.8,core*6.8);

    const tick = Math.floor(time / (this.reducedMotion ? 260 : 85));
    if (this.arcCache.tick !== tick || Math.abs(this.arcCache.radius - radius) > 8) {
      const paths: Point[][] = [];
      const count = Math.max(7, Math.round((this.reducedMotion ? 11 : 19) * this.quality));
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count + Math.sin(tick * .12 + i) * .16;
        const length = radius * (.65 + .35 * Math.abs(Math.sin(i * 18.3 + tick * .027)));
        const path = generateBolt(Math.cos(angle)*core*.12, Math.sin(angle)*core*.12,
          Math.cos(angle)*length, Math.sin(angle)*length, tick*241+i*2711);
        paths.push(path);
        if (i % 2 === 0 || e > .6) {
          const p = path[15];
          paths.push(generateBolt(p.x,p.y,Math.cos(angle+.35)*length*.9,Math.sin(angle+.35)*length*.9,tick+i*77));
        }
      }
      this.arcCache = {tick, radius, paths};
    }
    // Shared paths are stroked as a broad blue glow and a sharp, white-hot center.
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [lineWidth, color] of [[7,'rgba(25,94,255,.065)'],[3,'rgba(57,151,255,.27)'],[1,'rgba(183,227,255,.8)']] as const) {
      ctx.lineWidth = lineWidth * (1 + charge * (this.reducedMotion ? .12 : .28));
      ctx.strokeStyle = color; ctx.beginPath();
      for (const path of this.arcCache.paths) {
        ctx.moveTo(path[0].x,path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x,path[i].y);
      }
      ctx.stroke();
    }

    // Elliptical, noisy plasma loops give the core a volumetric weave.
    const loops = Math.round((this.reducedMotion ? 16 : 28) * this.quality);
    for (let i = 0; i < loops; i++) {
      ctx.save(); ctx.rotate(i * .73 + t * .13);
      ctx.beginPath();
      for (let j = 0; j <= 90; j++) {
        const angle = j / 90 * Math.PI * 2;
        const wobble = 1 + Math.sin(angle * 11 + tick * .71 + i * 2) * .075 + Math.sin(angle*23+i)*.035;
        const rx = Math.cos(angle) * core * wobble;
        const ry = Math.sin(angle) * core * (.2 + .7*Math.abs(Math.sin(i*.41+t*.15))) * wobble;
        if (j === 0) ctx.moveTo(rx,ry); else ctx.lineTo(rx,ry);
      }
      ctx.strokeStyle = i % 3 ? 'rgba(98,188,255,.52)' : 'rgba(204,241,255,.85)';
      ctx.lineWidth = i % 3 ? .9 : 1.4; ctx.stroke(); ctx.restore();
    }
    const center = ctx.createRadialGradient(0,0,0,0,0,core*.85);
    center.addColorStop(0, 'rgba(229,250,255,.83)'); center.addColorStop(.14, 'rgba(135,218,255,.43)');
    center.addColorStop(.48, 'rgba(74,163,255,.12)'); center.addColorStop(1, 'rgba(27,96,255,0)');
    ctx.fillStyle=center;ctx.fillRect(-core,-core,core*2,core*2);

    for (let i=0; i<visualParticleCount(this.dust.length,this.quality,this.reducedMotion); i++) {
      const p=this.dust[i], a=p.angle+t*p.speed;
      const orbit=(core+radius*p.orbit)*(.8+.1*Math.sin(t*.4+i));
      const px=Math.cos(a)*orbit, py=Math.sin(a)*orbit*.68;
      const alpha=.2+.6*Math.abs(Math.sin(t*.6+i));
      ctx.fillStyle=`rgba(151,218,255,${alpha})`;
      ctx.beginPath();ctx.arc(px,py,p.size*(i%5===0?1.1:.6),0,Math.PI*2);ctx.fill();
      if(i%13===0) {ctx.fillStyle=`rgba(122,196,255,${alpha*.3})`;ctx.fillRect(px-5,py-.4,10,.8);}
    }
    if (burst && pulse.opacity > 0) this.drawBurst(ctx, pulse, burst);
    ctx.restore();ctx.globalCompositeOperation='source-over';
  }

  private drawBurst(ctx: CanvasRenderingContext2D, pulse: BurstVisual, burst: BurstEvent) {
    // Paths are generated once per event, then expanded; no random flicker per frame.
    if (this.burstCache.id !== burst.id) {
      const paths: Point[][] = [];
      for (let i = 0; i < 20; i++) {
        const a = i * Math.PI * 2 / 20 + Math.sin(i * 3.71 + burst.id) * .09;
        const length = .7 + .3 * Math.abs(Math.sin(i * 8.39 + burst.id));
        paths.push(generateBolt(0, 0, Math.cos(a) * length, Math.sin(a) * length, burst.id * 193 + i * 971));
      }
      this.burstCache = { id: burst.id, paths };
    }
    ctx.globalAlpha = 1;
    const count = this.reducedMotion ? 7 : Math.round(20 * this.quality);
    for (const [width, color, alpha] of [[11, '43,126,255', .12], [3.8, '91,196,255', .53], [1.5, '219,249,255', .9]] as const) {
      ctx.lineWidth = width * (.65 + pulse.brightness);
      ctx.strokeStyle = `rgba(${color},${pulse.opacity * alpha})`;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const path = this.burstCache.paths[i];
        ctx.moveTo(path[0].x * pulse.radius, path[0].y * pulse.radius);
        for (let j = 1; j < path.length; j++) ctx.lineTo(path[j].x * pulse.radius, path[j].y * pulse.radius);
      }
      ctx.stroke();
    }
    const rings = this.reducedMotion ? 1 : 3;
    for (let i = 0; i < rings; i++) {
      const r = pulse.radius * (1 - i * .065);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(136,218,255,${pulse.opacity * (i ? .24 : .66)})`;
      ctx.lineWidth = i ? 1.1 : 2.5 + pulse.brightness * 3; ctx.stroke();
      // The main ring gets a restrained jagged electric edge.
      if (!i && !this.reducedMotion) {
        ctx.beginPath();
        for (let j = 0; j <= 100; j++) {
          const a = j * Math.PI * 2 / 100;
          const rr = r * (1 + Math.sin(j * 8.13 + burst.id) * .014);
          if (!j) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.strokeStyle = `rgba(214,247,255,${pulse.opacity * .55})`; ctx.lineWidth = 1.1; ctx.stroke();
      }
    }
    // Bounded inner echoes remain in frame after the leading shock passes it.
    for (let i = 0; i < (this.reducedMotion ? 1 : 2); i++) {
      ctx.beginPath(); ctx.arc(0, 0, pulse.aftershockRadius * (1 - i * .2), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(136,218,255,${pulse.opacity * (i ? .3 : .66)})`;
      ctx.lineWidth = i ? 1.1 : 2 + pulse.brightness * 2; ctx.stroke();
    }
    const sparks = visualParticleCount(pulse.particles, this.quality, false);
    for (let i = 0; i < sparks; i++) {
      const a = i * 2.39996 + burst.id * .37;
      // Reuse the same budget: three in four sparks ride the inner aftershock.
      const reach = i % 4 ? pulse.aftershockRadius : pulse.radius;
      const r = reach * (.28 + ((i * 31) % 100) / 100 * .7);
      const length = (4 + (i % 7) * 3) * pulse.motion;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a) * (r + length), Math.sin(a) * (r + length));
      ctx.strokeStyle = `rgba(208,242,255,${pulse.opacity * (.35 + (i % 4) * .14)})`;
      ctx.lineWidth = i % 4 ? .9 : 1.7; ctx.stroke();
    }
  }

  dispose() { this.observer.disconnect(); }
}
