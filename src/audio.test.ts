import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChidoriAudio, soundProfile } from './audio';

// Web Audio is not implemented by Vitest's Node runtime. This boundary records
// the real engine's routing, automation and ownership, not a replacement engine.
class TestParam {
  value = 0;
  events: { kind: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'set', value, time }); }
  setTargetAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'target', value, time }); }
  linearRampToValueAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'linear', value, time }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.value = value; this.events.push({ kind: 'exponential', value, time }); }
  cancelScheduledValues() {}
}

class TestNode {
  gain = new TestParam();
  frequency = new TestParam();
  detune = new TestParam();
  Q = new TestParam();
  pan = new TestParam();
  delayTime = new TestParam();
  threshold = new TestParam();
  knee = new TestParam();
  ratio = new TestParam();
  attack = new TestParam();
  release = new TestParam();
  type = '';
  loop = false;
  buffer?: unknown;
  curve?: Float32Array;
  oversample = '';
  onended: (() => void) | null = null;
  outputs: (TestNode | TestParam)[] = [];
  starts: number[] = [];
  stops: (number | undefined)[] = [];
  disconnected = false;
  constructor(readonly kind: string) {}
  connect(target: TestNode | TestParam) { this.outputs.push(target); return target; }
  disconnect() { this.disconnected = true; this.outputs = []; }
  start(time = 0) { this.starts.push(time); }
  stop(time?: number) { this.stops.push(time); }
  finish() { this.onended?.(); }
}

class TestAudioContext {
  currentTime = 5;
  sampleRate = 8000;
  state = 'suspended';
  destination = new TestNode('destination');
  nodes: TestNode[] = [];
  resumeGate?: Promise<void>;
  resume = vi.fn(async () => { await this.resumeGate; this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  make(kind: string) { const node = new TestNode(kind); this.nodes.push(node); return node; }
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('oscillator'); }
  createBufferSource() { return this.make('buffer'); }
  createBiquadFilter() { return this.make('filter'); }
  createDynamicsCompressor() { return this.make('compressor'); }
  createWaveShaper() { return this.make('limiter'); }
  createDelay() { return this.make('delay'); }
  createStereoPanner() { return this.make('panner'); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
}

function audioHarness() {
  const context = new TestAudioContext();
  const constructor = vi.fn(function () { return context; });
  vi.stubGlobal('AudioContext', constructor);
  const audio = new ChidoriAudio();
  return { audio, context, constructor };
}

const burst = (id: number, startedAt: number, mode: 'chidori' | 'shuriken' = 'chidori', strength = 1) =>
  ({ id, mode, strength, startedAt });
const activeSources = (context: TestAudioContext) => context.nodes.filter((node) => node.starts.length && !node.disconnected);

describe('soundProfile', () => {
  it('clamps energy and volume to the supported range', () => {
    expect(soundProfile(-4, -2)).toEqual(soundProfile(0, 0));
    expect(soundProfile(4, 2)).toEqual(soundProfile(1, 1));
    expect(soundProfile(Infinity, Infinity)).toEqual(soundProfile(1, 1));
    expect(soundProfile(-Infinity, -Infinity)).toEqual(soundProfile(0, 0));
  });

  it('uses a silent energy state and the default volume for NaN', () => {
    expect(soundProfile(NaN, NaN)).toEqual(soundProfile(0, 0.35));
  });

  it('increases brightness and musical/electric intensity monotonically', () => {
    const profiles = [0, 0.25, 0.5, 0.75, 1].map((energy) => soundProfile(energy, 0.35));
    for (let index = 1; index < profiles.length; index++) {
      const previous = profiles[index - 1];
      const current = profiles[index];
      expect(current.filterHz).toBeGreaterThan(previous.filterHz);
      expect(current.crackleHz).toBeGreaterThan(previous.crackleHz);
      expect(current.padGain).toBeGreaterThanOrEqual(previous.padGain);
      expect(current.arpGain).toBeGreaterThan(previous.arpGain);
      expect(current.percussionGain).toBeGreaterThan(previous.percussionGain);
      expect(current.electricGain).toBeGreaterThan(previous.electricGain);
    }
  });

  it('keeps user volume independent from gesture energy', () => {
    expect(soundProfile(0, 0.21).volume).toBe(0.21);
    expect(soundProfile(1, 0.21).volume).toBe(0.21);
    expect(soundProfile(0, 0.21).masterGain).toBe(soundProfile(1, 0.21).masterGain);
    expect(soundProfile(1, 0).masterGain).toBe(0);
    expect(soundProfile(0.5, 0.8).masterGain).toBeCloseTo(2 * soundProfile(0.5, 0.4).masterGain);
  });

  it('retains an audible tonal bed at rest and bounds every gain at full power', () => {
    const rest = soundProfile(0, 0.35);
    const peak = soundProfile(1, 1);
    expect(rest.padGain).toBeGreaterThan(0.1);
    expect(rest.arpGain).toBeGreaterThan(0.05);
    expect(peak.masterGain).toBeLessThanOrEqual(0.65);
    expect(peak.electricGain).toBeLessThan(peak.padGain / 3);
    for (const [key, value] of Object.entries(peak)) {
      expect(Number.isFinite(value), key).toBe(true);
      expect(value, key).toBeGreaterThanOrEqual(0);
      if (key.endsWith('Gain')) expect(value, key).toBeLessThanOrEqual(0.65);
    }
  });

  it('uses distinct bounded electric and wind mixes without changing music or user volume', () => {
    const electric = soundProfile(1, 0.35, 'chidori');
    const wind = soundProfile(1, 0.35, 'shuriken');
    expect(electric.electricGain).toBeGreaterThan(0);
    expect(electric.windGain).toBe(0);
    expect(wind.electricGain).toBe(0);
    expect(wind.windGain).toBeGreaterThan(0);
    expect(wind.padGain).toBe(electric.padGain);
    expect(wind.masterGain).toBe(electric.masterGain);
    for (const mode of ['chidori', 'shuriken'] as const) {
      for (const input of [NaN, -Infinity, Infinity, -1, 0, 0.5, 1, 2]) {
        for (const [key, value] of Object.entries(soundProfile(input, input, mode))) {
          expect(Number.isFinite(value), key).toBe(true);
          expect(value, key).toBeGreaterThanOrEqual(0);
          if (key.endsWith('Gain')) expect(value, key).toBeLessThanOrEqual(0.65);
        }
      }
    }
  });
});

describe('burst audio and effect ownership', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('consumes events before start without allocating a context or replaying them', async () => {
    vi.useFakeTimers();
    const { audio, constructor } = audioHarness();
    audio.setEffect('shuriken');
    expect(audio.triggerBurst(burst(1, 1000, 'shuriken'))).toBe(false);
    expect(constructor).not.toHaveBeenCalled();
    await audio.start();
    expect(audio.triggerBurst(burst(1, 1000, 'shuriken'))).toBe(false);
    expect(audio.triggerBurst(burst(2, 2000, 'shuriken'))).toBe(true);
    audio.dispose();
  });

  it('routes a bounded electric crack, downward chirp and impact through one effects bus', async () => {
    vi.useFakeTimers();
    const { audio, context } = audioHarness();
    await audio.start();
    const boundary = context.nodes.length;
    expect(audio.triggerBurst(burst(1, 1000))).toBe(true);
    const nodes = context.nodes.slice(boundary);
    const sources = nodes.filter((node) => node.starts.length);
    expect(sources).toHaveLength(3);
    expect(nodes.some((node) => node.kind === 'filter' && node.type === 'bandpass')).toBe(true);
    const tones = sources.filter((node) => node.kind === 'oscillator');
    expect(tones).toHaveLength(2);
    expect(tones.some((node) => node.frequency.events[0].value < 150)).toBe(true);
    expect(tones.every((node) => node.frequency.events.at(-1)!.value < node.frequency.events[0].value)).toBe(true);
    const outputs = nodes.filter((node) => node.kind === 'gain').flatMap((node) => node.outputs)
      .filter((node) => node instanceof TestNode && !nodes.includes(node));
    expect(new Set(outputs).size).toBe(1);
    const bus = outputs[0] as TestNode;
    expect(bus.kind).toBe('gain');
    const compressor = bus.outputs[0] as TestNode;
    expect(compressor.kind).toBe('compressor');
    const limiter = compressor.outputs[0] as TestNode;
    expect(limiter.kind).toBe('limiter');
    const master = limiter.outputs[0] as TestNode;
    expect(master.gain.value).toBeCloseTo(0.35 * 0.65);
    expect(master.outputs).toEqual([context.destination]);
    for (const node of nodes) {
      for (const parameter of [node.gain, node.frequency]) {
        for (const event of parameter.events) {
          expect(Number.isFinite(event.value)).toBe(true);
          expect(event.value).toBeGreaterThanOrEqual(0);
          if (parameter === node.gain) expect(event.value).toBeLessThanOrEqual(0.65);
        }
      }
    }
    for (const source of sources) {
      expect(source.stops[0]! - source.starts[0]).toBeLessThan(0.85);
      source.finish();
    }
    expect(nodes.every((node) => node.disconnected)).toBe(true);
    audio.dispose();
  });

  it('deduplicates monotonic event IDs and enforces a 1000ms event-time cooldown', async () => {
    vi.useFakeTimers();
    const { audio, context } = audioHarness();
    await audio.start();
    expect(audio.triggerBurst(burst(10, 1000))).toBe(true);
    const count = context.nodes.length;
    expect(audio.triggerBurst(burst(10, 5000))).toBe(false);
    expect(audio.triggerBurst(burst(9, 5000))).toBe(false);
    expect(audio.triggerBurst(burst(11, 1999))).toBe(false);
    expect(audio.triggerBurst(burst(11, 2000))).toBe(false);
    expect(context.nodes).toHaveLength(count);
    expect(audio.triggerBurst(burst(12, 2000))).toBe(true);
    expect(audio.triggerBurst(burst(13, 1500))).toBe(false);
    audio.dispose();
  });

  it('consumes muted, zero-volume, wrong-mode and paused events without replay', async () => {
    vi.useFakeTimers();
    const { audio, context } = audioHarness();
    await audio.start();
    let id = 1;
    for (const disable of [() => audio.setMuted(true), () => audio.setVolume(0)]) {
      disable();
      const count = context.nodes.length;
      expect(audio.triggerBurst(burst(id, id * 1000))).toBe(false);
      expect(context.nodes).toHaveLength(count);
      audio.setMuted(false);
      audio.setVolume(0.35);
      expect(audio.triggerBurst(burst(id, id * 1000))).toBe(false);
      id++;
    }
    expect(audio.triggerBurst(burst(id++, 3000, 'shuriken'))).toBe(false);
    audio.pause();
    expect(audio.triggerBurst(burst(id, 4000))).toBe(false);
    await audio.start();
    expect(audio.triggerBurst(burst(id, 4000))).toBe(false);
    expect(audio.triggerBurst(burst(++id, 5000))).toBe(true);
    audio.dispose();
  });

  it('switches to modulated air without recreating music and clears burst nodes immediately', async () => {
    vi.useFakeTimers();
    const { audio, context, constructor } = audioHarness();
    await audio.start();
    const musicSources = activeSources(context);
    const boundary = context.nodes.length;
    audio.triggerBurst(burst(1, 1000));
    const oldBurst = context.nodes.slice(boundary);
    audio.setEffect('shuriken');
    expect(oldBurst.every((node) => node.disconnected)).toBe(true);
    expect(musicSources.every((node) => !node.disconnected)).toBe(true);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(context.nodes.some((node) => node.kind === 'oscillator' && node.frequency.value < 3 && node.outputs.length)).toBe(true);
    const windBoundary = context.nodes.length;
    expect(audio.triggerBurst(burst(2, 2000, 'shuriken'))).toBe(true);
    const windNodes = context.nodes.slice(windBoundary);
    expect(windNodes.some((node) => node.kind === 'buffer')).toBe(true);
    expect(windNodes.some((node) => node.kind === 'filter' && node.frequency.events.length >= 2)).toBe(true);
    expect(windNodes.filter((node) => node.kind === 'oscillator')).toHaveLength(0);
    audio.dispose();
  });

  it('bounds concurrent bursts even if incoming timestamps advance faster than the audio clock', async () => {
    vi.useFakeTimers();
    const { audio, context } = audioHarness();
    await audio.start();
    const baseline = activeSources(context).length;
    for (let id = 1; id <= 30; id++) {
      expect(audio.triggerBurst(burst(id, id * 1000, 'chidori', id % 2 ? NaN : Infinity))).toBe(true);
      expect(activeSources(context).length).toBeLessThanOrEqual(baseline + 3);
    }
    audio.dispose();
    expect(context.nodes.every((node) => node.disconnected)).toBe(true);
  });

  it('clears live burst tails on mute and zero-volume without interrupting music', async () => {
    vi.useFakeTimers();
    const { audio, context } = audioHarness();
    await audio.start();
    const music = activeSources(context);
    for (const [index, quiet] of [() => audio.setMuted(true), () => audio.setVolume(0)].entries()) {
      const boundary = context.nodes.length;
      expect(audio.triggerBurst(burst(index + 1, index * 1000))).toBe(true);
      const nodes = context.nodes.slice(boundary);
      quiet();
      expect(nodes.every((node) => node.disconnected)).toBe(true);
      expect(music.every((node) => !node.disconnected)).toBe(true);
      audio.setMuted(false);
      audio.setVolume(0.35);
    }
    audio.dispose();
  });

  it('pause releases all sources and helper nodes immediately and resumes in the same context', async () => {
    vi.useFakeTimers();
    const { audio, context, constructor } = audioHarness();
    audio.setEffect('shuriken');
    audio.setVolume(0.19);
    await audio.start();
    audio.triggerBurst(burst(1, 1000, 'shuriken'));
    audio.setMuted(true);
    audio.pause();
    expect(context.nodes.every((node) => node.disconnected)).toBe(true);
    expect(activeSources(context)).toHaveLength(0);
    await audio.start();
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(audio.isMuted).toBe(true);
    audio.setMuted(false);
    const master = context.nodes.filter((node) => node.outputs.includes(context.destination)).at(-1)!;
    expect(master.gain.value).toBeCloseTo(0.19 * 0.65);
    expect(audio.triggerBurst(burst(2, 2000, 'shuriken'))).toBe(true);
    audio.dispose();
    expect(context.nodes.every((node) => node.disconnected)).toBe(true);
  });

  it('consumes bursts while unlock is pending and never starts nodes after pause or disposal', async () => {
    vi.useFakeTimers();
    for (const action of ['pause', 'dispose'] as const) {
      const { audio, context } = audioHarness();
      let resolve!: () => void;
      context.resumeGate = new Promise<void>((done) => { resolve = done; });
      const start = audio.start();
      expect(audio.triggerBurst(burst(1, 1000))).toBe(false);
      audio[action]();
      resolve();
      await start;
      expect(audio.isPlaying).toBe(false);
      expect(context.nodes).toHaveLength(0);
      if (action === 'pause') {
        await audio.start();
        expect(audio.triggerBurst(burst(1, 1000))).toBe(false);
      }
      audio.dispose();
    }
  });

  it('resumes pads on the current musical chord instead of reverting to the first chord', async () => {
    vi.useFakeTimers();
    const { audio, context } = audioHarness();
    await audio.start();
    for (let index = 0; index < 16; index++) {
      context.currentTime += 0.4;
      vi.advanceTimersByTime(400);
    }
    const previousPads = activeSources(context).filter((node) => node.kind === 'oscillator' && !node.onended)
      .slice(0, 8).map((node) => node.frequency.value);
    audio.pause();
    await audio.start();
    const nextPads = activeSources(context).filter((node) => node.kind === 'oscillator' && !node.onended)
      .slice(0, 8).map((node) => node.frequency.value);
    expect(nextPads).toEqual(previousPads);
    audio.dispose();
  });

  it('lets a new start win over an older cancelled unlock without allocating another context', async () => {
    vi.useFakeTimers();
    const { audio, context, constructor } = audioHarness();
    let resolveOld!: () => void;
    context.resumeGate = new Promise<void>((resolve) => { resolveOld = resolve; });
    const older = audio.start();
    audio.pause();
    context.resumeGate = undefined;
    await audio.start();
    const nodeCount = context.nodes.length;
    resolveOld();
    await older;
    expect(audio.isPlaying).toBe(true);
    expect(context.state).toBe('running');
    expect(context.nodes).toHaveLength(nodeCount);
    expect(constructor).toHaveBeenCalledTimes(1);
    audio.dispose();
  });
});

describe('ChidoriAudio lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not allocate or play audio until explicitly started', () => {
    const constructor = vi.fn();
    vi.stubGlobal('AudioContext', constructor);
    const audio = new ChidoriAudio();
    expect(audio.isPlaying).toBe(false);
    expect(audio.isMuted).toBe(false);
    audio.setEnergy(1);
    audio.setVolume(0.17);
    audio.setMuted(true);
    expect(audio.isMuted).toBe(true);
    audio.setMuted(false);
    audio.pause();
    audio.dispose();
    audio.dispose();
    expect(constructor).not.toHaveBeenCalled();
  });

  it('reports unsupported Web Audio without an unhandled synchronous exception', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const audio = new ChidoriAudio();
    await expect(audio.start()).rejects.toThrow(/Web Audio/);
    expect(audio.isPlaying).toBe(false);
    audio.dispose();
  });

  it('constructs and resumes in the click turn, and cancels a paused pending start', async () => {
    let resolveResume!: () => void;
    const resumed = new Promise<void>((resolve) => { resolveResume = resolve; });
    const context = {
      state: 'suspended',
      resume: vi.fn(() => resumed),
      suspend: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    };
    const constructor = vi.fn(function () { return context; });
    vi.stubGlobal('AudioContext', constructor);
    const audio = new ChidoriAudio();
    const first = audio.start();
    const duplicate = audio.start();
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
    audio.pause();
    resolveResume();
    await Promise.all([first, duplicate]);
    expect(audio.isPlaying).toBe(false);
    audio.dispose();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('cannot restart after disposal', async () => {
    const audio = new ChidoriAudio();
    audio.dispose();
    await expect(audio.start()).rejects.toThrow(/disposed/);
    expect(audio.isPlaying).toBe(false);
  });
});
