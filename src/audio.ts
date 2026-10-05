import type { BurstEvent, EffectMode } from './effects';

/** Audio-rate controls. Gains are linear amplitudes, filter values are hertz. */
export interface SoundProfile {
  energy: number;
  volume: number;
  /** User volume only; energy never changes the output gain. Bounded [0, 0.65]. */
  masterGain: number;
  /** Musical-layer gains, kept larger than the separate electric texture. */
  padGain: number;
  arpGain: number;
  percussionGain: number;
  /** Bounded [0.003, 0.055] in electric mode, zero in wind mode. */
  electricGain: number;
  /** Smooth air texture, independent from the electric/crackle layer. */
  windGain: number;
  windHz: number;
  windRate: number;
  /** Musical low-pass: [1050, 5450] Hz. */
  filterHz: number;
  /** Electric band-pass: [1400, 5700] Hz. */
  crackleHz: number;
}

const DEFAULT_VOLUME = 0.35;
const unit = (value: number, fallback = 0): number =>
  Number.isNaN(value) ? fallback : Math.min(1, Math.max(0, value));

/** Pure, finite mapping; NaN means no energy / default volume, infinities clamp. */
export function soundProfile(energy: number, volume: number, effect: EffectMode = 'chidori'): SoundProfile {
  const intensity = unit(energy);
  const level = unit(volume, DEFAULT_VOLUME);
  return {
    energy: intensity,
    volume: level,
    masterGain: level * 0.65,
    padGain: 0.28 + intensity * 0.12,
    arpGain: 0.12 + intensity * 0.18,
    percussionGain: 0.035 + intensity * 0.045,
    electricGain: effect === 'chidori' ? 0.003 + intensity ** 1.6 * 0.052 : 0,
    windGain: effect === 'shuriken' ? 0.012 + intensity ** 1.25 * 0.07 : 0,
    windHz: 850 + intensity * 2200,
    windRate: 0.45 + intensity * 1.15,
    filterHz: 1050 + intensity * 4400,
    crackleHz: 1400 + intensity * 4300,
  };
}

type Source = OscillatorNode | AudioBufferSourceNode;
interface AudioGraph {
  master: GainNode;
  pad: GainNode;
  arp: GainNode;
  percussion: GainNode;
  electric: GainNode;
  wind: GainNode;
  effects: GainNode;
  filter: BiquadFilterNode;
  crackleFilter: BiquadFilterNode;
  windFilter: BiquadFilterNode;
  windModulator: OscillatorNode;
  pads: OscillatorNode[];
  bass: OscillatorNode;
  noise: AudioBuffer;
  air: AudioBuffer;
}

// Original four-chord ambient progression: Em9 / Cmaj7 / G / D9.
const CHORDS = [
  [52, 59, 62, 66], [48, 55, 59, 64], [43, 55, 59, 62], [50, 57, 60, 64],
] as const;
const ARPEGGIO = [0, 2, 1, 3, 2, 1, 3, 2] as const;
const STEP_SECONDS = 60 / 84 / 2;
const frequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/**
 * Entirely original synthesis, with no audio downloads. Call start from a real
 * click, pause when hidden, and dispose when leaving. Instances are single-use
 * after dispose; pause/start retains the selected effect, volume, mute and energy.
 */
export class ChidoriAudio {
  private context?: AudioContext;
  private graph?: AudioGraph;
  private readonly nodes = new Set<AudioNode>();
  private readonly sources = new Set<Source>();
  private readonly bursts = new Set<Source>();
  private readonly sourceExtras = new Map<Source, AudioNode[]>();
  private timer?: ReturnType<typeof setInterval>;
  private pendingStart?: Promise<void>;
  private generation = 0;
  private disposed = false;
  private playing = false;
  private wantsPlaying = false;
  private muted = false;
  private energy = 0;
  private volume = DEFAULT_VOLUME;
  private effect: EffectMode = 'chidori';
  private lastBurstId = -1;
  private lastBurstAt = -Infinity;
  private step = 0;
  private nextStepTime = 0;

  get isPlaying(): boolean { return this.playing; }
  get isMuted(): boolean { return this.muted; }

  async start(): Promise<void> {
    if (this.disposed) throw new Error('This audio engine has been disposed.');
    if (this.pendingStart) return this.pendingStart;
    if (this.playing && this.context?.state === 'running') return;

    this.wantsPlaying = true;
    const generation = ++this.generation;
    if (!this.context) {
      const browser = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const Context = browser.AudioContext ?? browser.webkitAudioContext;
      if (!Context) throw new Error('This browser does not support Web Audio.');
      this.context = new Context();
    }
    const context = this.context;
    // Deliberately before the first await: preserve transient click activation.
    const resume = context.resume();
    const pending = (async () => {
      await resume;
      if (this.disposed || generation !== this.generation) {
        // A delayed unlock may finish after pause. Never re-awaken the graph.
        if (!this.disposed && !this.wantsPlaying && context.state !== 'closed') {
          await context.suspend().catch(() => {});
        }
        return;
      }
      if (!this.graph) this.graph = this.createGraph(context);
      this.playing = true;
      this.applyProfile();
      this.nextStepTime = context.currentTime + 0.06;
      this.schedule();
      if (this.timer === undefined) this.timer = setInterval(() => this.schedule(), 40);
    })();
    this.pendingStart = pending;
    try {
      await pending;
    } finally {
      if (this.pendingStart === pending) this.pendingStart = undefined;
    }
  }

  setEnergy(value: number): void {
    const next = unit(value);
    if (Math.abs(next - this.energy) < 0.001) return;
    this.energy = next;
    this.applyProfile();
  }

  setVolume(value: number): void {
    this.volume = unit(value, DEFAULT_VOLUME);
    if (this.volume === 0) this.clearBursts();
    this.applyProfile();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if (value) this.clearBursts();
    this.applyProfile();
  }

  setEffect(mode: EffectMode): void {
    if (mode === this.effect) return;
    this.clearBursts();
    this.effect = mode;
    this.applyProfile();
  }

  /** Consume once, even when inaudible: unmute/resume never replays an event. */
  triggerBurst(event: BurstEvent): boolean {
    if (!Number.isSafeInteger(event.id) || event.id <= this.lastBurstId) return false;
    this.lastBurstId = event.id;
    if (!Number.isFinite(event.startedAt) || event.startedAt < 0
      || event.startedAt - this.lastBurstAt < 1000 || event.mode !== this.effect
      || this.disposed || !this.playing || this.muted || this.volume === 0
      || !this.graph || !this.context || this.context.state !== 'running') return false;
    this.lastBurstAt = event.startedAt;
    // At most one event's voices live, even if a caller supplies future times.
    this.clearBursts();
    const strength = unit(event.strength);
    const time = this.context.currentTime;
    if (event.mode === 'chidori') {
      this.burstNoise(time, 0.34, 0.25 + strength * 0.3, 3300 + strength * 1900, 950, false);
      this.tone(2900 + strength * 1700, 'sine', time, 0.25,
        0.045 + strength * 0.075, this.graph.effects, 0.004, 540, true);
      this.tone(105, 'sine', time, 0.31,
        0.13 + strength * 0.19, this.graph.effects, 0.006, 38, true);
    } else {
      this.burstNoise(time, 0.56, 0.3 + strength * 0.3, 1100, 4800 + strength * 1700, true);
    }
    return true;
  }

  pause(): void {
    ++this.generation;
    this.pendingStart = undefined;
    this.playing = false;
    this.wantsPlaying = false;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.applyProfile();
    // Stop and disconnect synchronously; onended can be delayed indefinitely
    // in a suspended tab. Resume rebuilds in the same context with no backlog.
    this.clearGraph();
    if (this.context && this.context.state !== 'closed') {
      void this.context.suspend().catch(() => { /* A closing context is harmless. */ });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.add(node);
    return node;
  }

  private stop(source: Source): void {
    source.onended = null;
    try { source.stop(); } catch { /* Already stopped or not yet started. */ }
    source.disconnect();
    this.sources.delete(source);
    this.bursts.delete(source);
    this.nodes.delete(source);
    for (const node of this.sourceExtras.get(source) ?? []) {
      node.disconnect();
      this.nodes.delete(node);
    }
    this.sourceExtras.delete(source);
  }

  private clearBursts(): void {
    for (const source of this.bursts) this.stop(source);
  }

  private clearGraph(): void {
    for (const source of this.sources) this.stop(source);
    for (const node of this.nodes) node.disconnect();
    this.nodes.clear();
    this.sourceExtras.clear();
    this.bursts.clear();
    this.graph = undefined;
  }

  private createGraph(context: AudioContext): AudioGraph {
    const gain = (value = 0): GainNode => {
      const node = this.track(context.createGain());
      node.gain.value = value;
      return node;
    };
    const master = gain();
    const compressor = this.track(context.createDynamicsCompressor());
    compressor.threshold.value = -14;
    compressor.knee.value = 16;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;
    const limiter = this.track(context.createWaveShaper());
    const curve = new Float32Array(2048);
    for (let index = 0; index < curve.length; index++) {
      const input = index / (curve.length - 1) * 2 - 1;
      curve[index] = Math.tanh(input);
    }
    limiter.curve = curve;
    limiter.oversample = '2x';
    compressor.connect(limiter);
    limiter.connect(master);
    master.connect(context.destination);

    const filter = this.track(context.createBiquadFilter());
    filter.type = 'lowpass';
    filter.Q.value = 0.55;
    filter.frequency.value = 1050;
    filter.connect(compressor);
    const pad = gain(0.28);
    const arp = gain(0.12);
    const percussion = gain(0.035);
    const electric = gain(0.003);
    const wind = gain();
    const effects = gain(1);
    pad.connect(filter);
    arp.connect(filter);
    percussion.connect(compressor);
    electric.connect(effects);
    wind.connect(effects);
    effects.connect(compressor);

    // A quiet stereo echo is musical space, without an asset or long reverb tail.
    const delay = this.track(context.createDelay(1));
    delay.delayTime.value = STEP_SECONDS * 1.5;
    const feedback = gain(0.26);
    const wet = gain(0.22);
    arp.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(filter);

    const pads: OscillatorNode[] = [];
    const currentChord = CHORDS[Math.floor(this.step / 16)];
    currentChord.forEach((note, index) => {
      const pan = this.track(context.createStereoPanner());
      pan.pan.value = (index / 3 * 2 - 1) * 0.65;
      pan.connect(pad);
      for (const detune of [-5, 5]) {
        const oscillator = this.track(context.createOscillator());
        oscillator.type = detune < 0 ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency(note);
        oscillator.detune.value = detune;
        const level = gain(0.065);
        oscillator.connect(level);
        level.connect(pan);
        oscillator.start();
        this.sources.add(oscillator);
        pads.push(oscillator);
      }
    });
    const bass = this.track(context.createOscillator());
    bass.type = 'sine';
    bass.frequency.value = frequency(currentChord[0] - 12);
    const bassLevel = gain(0.16);
    bass.connect(bassLevel);
    bassLevel.connect(pad);
    bass.start();
    this.sources.add(bass);

    const noise = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const samples = noise.getChannelData(0);
    let random = 0x4c484944;
    let smoothed = 0;
    for (let index = 0; index < samples.length; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const white = random / 0xffffffff * 2 - 1;
      smoothed = smoothed * 0.72 + white * 0.28;
      const time = index / context.sampleRate;
      const crackle = 0.22 + 0.78 * Math.max(0, Math.sin(time * 31) * Math.sin(time * 53));
      samples[index] = (white * 0.55 + smoothed * 0.45) * crackle;
    }
    const crackleFilter = this.track(context.createBiquadFilter());
    crackleFilter.type = 'bandpass';
    crackleFilter.Q.value = 1.25;
    crackleFilter.frequency.value = 1400;
    const source = this.track(context.createBufferSource());
    source.buffer = noise;
    source.loop = true;
    source.connect(crackleFilter);
    crackleFilter.connect(electric);
    source.start();
    this.sources.add(source);

    // Smooth, unpulsed air contrasts with the electric noise's sharp crackles.
    const air = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const airSamples = air.getChannelData(0);
    let airSmoothed = 0;
    for (let index = 0; index < airSamples.length; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const white = random / 0xffffffff * 2 - 1;
      airSmoothed = airSmoothed * 0.93 + white * 0.07;
      airSamples[index] = airSmoothed * 0.75 + white * 0.25;
    }
    const windFilter = this.track(context.createBiquadFilter());
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.7;
    windFilter.frequency.value = 850;
    const airSource = this.track(context.createBufferSource());
    airSource.buffer = air;
    airSource.loop = true;
    airSource.connect(windFilter);
    windFilter.connect(wind);
    airSource.start();
    this.sources.add(airSource);
    const windModulator = this.track(context.createOscillator());
    windModulator.type = 'sine';
    windModulator.frequency.value = 0.45;
    const sweep = gain(480);
    windModulator.connect(sweep);
    sweep.connect(windFilter.frequency);
    windModulator.start();
    this.sources.add(windModulator);
    return { master, pad, arp, percussion, electric, wind, effects, filter,
      crackleFilter, windFilter, windModulator, pads, bass, noise, air };
  }

  private applyProfile(): void {
    if (!this.graph || !this.context || this.context.state === 'closed') return;
    const profile = soundProfile(this.energy, this.volume, this.effect);
    const now = this.context.currentTime;
    const smooth = (parameter: AudioParam, value: number, time = 0.13): void => {
      parameter.cancelScheduledValues(now);
      parameter.setTargetAtTime(value, now, time);
    };
    smooth(this.graph.master.gain, this.playing && !this.muted ? profile.masterGain : 0, 0.055);
    smooth(this.graph.pad.gain, profile.padGain);
    smooth(this.graph.arp.gain, profile.arpGain);
    smooth(this.graph.percussion.gain, profile.percussionGain);
    smooth(this.graph.electric.gain, profile.electricGain);
    smooth(this.graph.wind.gain, profile.windGain);
    smooth(this.graph.windFilter.frequency, profile.windHz, 0.2);
    smooth(this.graph.windModulator.frequency, profile.windRate, 0.2);
    smooth(this.graph.filter.frequency, profile.filterHz, 0.18);
    smooth(this.graph.crackleFilter.frequency, profile.crackleHz, 0.18);
  }

  private schedule(): void {
    if (!this.playing || !this.context || !this.graph) return;
    const now = this.context.currentTime;
    // Do not create a backlog after a throttled timer or suspended device.
    if (this.nextStepTime < now - STEP_SECONDS) this.nextStepTime = now + 0.02;
    while (this.nextStepTime < now + 0.15) {
      this.playStep(this.nextStepTime);
      this.nextStepTime += STEP_SECONDS;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(time: number): void {
    const graph = this.graph!;
    const chord = CHORDS[Math.floor(this.step / 16)];
    if (this.step % 16 === 0) {
      graph.pads.forEach((oscillator, index) => {
        oscillator.frequency.setTargetAtTime(frequency(chord[Math.floor(index / 2)]), time, 0.42);
      });
      graph.bass.frequency.setTargetAtTime(frequency(chord[0] - 12), time, 0.3);
    }
    const note = chord[ARPEGGIO[this.step % ARPEGGIO.length]] + 12;
    this.tone(frequency(note), 'triangle', time, 0.64, 0.22, graph.arp, 0.018);
    if (this.step % 4 === 0) this.tone(78, 'sine', time, 0.23, 0.5, graph.percussion, 0.006, 42);
    if (this.step % 4 === 2) this.hat(time);
    if (this.effect === 'chidori' && this.energy > 0.3 && this.step % 2 === 1) {
      const chirp = 1800 + this.energy * 2600 + (this.step % 3) * 190;
      this.tone(chirp, 'sine', time, 0.08, 0.23, graph.electric, 0.008, chirp * 1.42);
    }
  }

  private tone(
    hz: number, type: OscillatorType, time: number, duration: number,
    amplitude: number, output: AudioNode, attack: number, endHz?: number, burst = false,
  ): void {
    const context = this.context!;
    const oscillator = this.track(context.createOscillator());
    const envelope = this.track(context.createGain());
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, time);
    if (endHz) oscillator.frequency.exponentialRampToValueAtTime(endHz, time + duration * 0.8);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(envelope);
    envelope.connect(output);
    this.oneShot(oscillator, envelope, time, duration + 0.02, [], burst);
  }

  private hat(time: number): void {
    const context = this.context!;
    const source = this.track(context.createBufferSource());
    source.buffer = this.graph!.noise;
    const highpass = this.track(context.createBiquadFilter());
    highpass.type = 'highpass';
    highpass.frequency.value = 6200;
    const envelope = this.track(context.createGain());
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(0.24, time + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.065);
    source.connect(highpass);
    highpass.connect(envelope);
    envelope.connect(this.graph!.percussion);
    this.oneShot(source, envelope, time, 0.08, [highpass]);
  }

  private burstNoise(
    time: number, duration: number, amplitude: number, startHz: number, endHz: number, wind: boolean,
  ): void {
    const context = this.context!;
    const source = this.track(context.createBufferSource());
    source.buffer = wind ? this.graph!.air : this.graph!.noise;
    const filter = this.track(context.createBiquadFilter());
    filter.type = 'bandpass';
    filter.Q.value = wind ? 0.8 : 1.7;
    filter.frequency.setValueAtTime(startHz, time);
    filter.frequency.exponentialRampToValueAtTime(endHz, time + duration * (wind ? 0.32 : 0.75));
    if (wind) filter.frequency.exponentialRampToValueAtTime(650, time + duration);
    const envelope = this.track(context.createGain());
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(amplitude, time + (wind ? 0.065 : 0.005));
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.graph!.effects);
    this.oneShot(source, envelope, time, duration + 0.02, [filter], true);
  }

  private oneShot(
    source: Source, envelope: GainNode, time: number, duration: number,
    extras: AudioNode[] = [], burst = false,
  ): void {
    this.sources.add(source);
    this.sourceExtras.set(source, [envelope, ...extras]);
    if (burst) this.bursts.add(source);
    source.onended = () => this.stop(source);
    source.start(time);
    source.stop(time + duration);
  }
}
