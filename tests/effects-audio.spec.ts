import { expect, test, type Page } from '@playwright/test';
import { openSettings } from './helpers/settings';

type EffectName = 'chidori' | 'shuriken';
interface AudioFrame {
  ms: number;
  rms: number;
  peak: number;
  bands: number[];
}
interface EffectAudioProbe {
  context: AudioContext;
  analyser: AnalyserNode;
  feed: AudioNode | null;
  feeds: WeakSet<AudioNode>;
  connections: number;
}

declare global {
  interface Window {
    __effectAudioProbes: EffectAudioProbe[];
    __effectAudioCapture: Promise<AudioFrame[]>;
  }
}

// Read the real post-limiter destination feed, as in audio.spec.ts. No synth,
// audio clock, gain, scheduled source, or AudioContext operation is mocked.
async function installOutputProbe(page: Page) {
  await page.addInitScript(() => {
    window.__effectAudioProbes = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const analyser = this.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0;
        window.__effectAudioProbes.push({ context: this, analyser, feed: null, feeds: new WeakSet(), connections: 0 });
      }
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const result = Reflect.apply(connect, this, args);
      if (args[0] === this.context.destination) {
        const probe = window.__effectAudioProbes.find(candidate => candidate.context === this.context);
        // A resumed graph gets a new master, but retains its native context.
        if (probe && !probe.feeds.has(this)) {
          Reflect.apply(connect, this, [probe.analyser]);
          probe.feed = this;
          probe.feeds.add(this);
          probe.connections++;
        }
      }
      return result;
    } as typeof AudioNode.prototype.connect;
    navigator.mediaDevices.getUserMedia = async () => { throw new Error('Audio-only tests must never request a camera'); };
  });
}

async function audioState(page: Page) {
  return page.evaluate(() => ({
    contexts: window.__effectAudioProbes.length,
    state: window.__effectAudioProbes[0]?.context.state ?? 'missing',
    connections: window.__effectAudioProbes[0]?.connections ?? 0,
  }));
}

async function captureOutput(page: Page, durationMs: number, action?: () => Promise<unknown>) {
  await page.evaluate((duration) => {
    const probe = window.__effectAudioProbes[0];
    if (!probe) throw new Error('Trusted UI click has not created an AudioContext');
    // A fresh passive analyser has no pre-suspend history. Replacing ONLY the
    // tap lets resume assertions inspect every frame, including the attack,
    // without flushing, resuming, or otherwise changing the actual audio graph.
    const analyser = probe.context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    if (probe.feed) {
      try { probe.feed.disconnect(probe.analyser); } catch { /* App may have already disconnected its old graph. */ }
      probe.feed.connect(analyser);
    }
    probe.analyser = analyser;
    window.__effectAudioCapture = new Promise<AudioFrame[]>((resolve) => {
      const time = new Float32Array(probe.analyser.fftSize);
      const spectrum = new Float32Array(probe.analyser.frequencyBinCount);
      const frames: AudioFrame[] = [];
      const started = performance.now();
      const sample = () => {
        probe.analyser.getFloatTimeDomainData(time);
        probe.analyser.getFloatFrequencyData(spectrum);
        let squares = 0;
        let peak = 0;
        for (const value of time) { squares += value * value; peak = Math.max(peak, Math.abs(value)); }
        const bands = [0, 0, 0, 0];
        for (let bin = 1; bin < spectrum.length; bin++) {
          const hz = bin * probe.context.sampleRate / probe.analyser.fftSize;
          if (hz < 30 || hz >= 12000) continue;
          const band = hz < 200 ? 0 : hz < 1500 ? 1 : hz < 4500 ? 2 : 3;
          bands[band] += 10 ** (spectrum[bin] / 10);
        }
        frames.push({ ms: performance.now() - started, rms: Math.sqrt(squares / time.length), peak, bands });
        if (performance.now() - started >= duration) { clearInterval(timer); resolve(frames); }
      };
      // This is an intentional observation window, not a readiness sleep. It
      // samples native buffers throughout the complete short-lived transient.
      const timer = setInterval(sample, 16);
      sample();
    });
  }, durationMs);
  await action?.();
  const frames = await page.evaluate(() => window.__effectAudioCapture);
  expect(frames.length).toBeGreaterThan(5);
  return {
    frames,
    maxRms: Math.max(...frames.map(frame => frame.rms)),
    peak: Math.max(...frames.map(frame => frame.peak)),
    bands: [0, 1, 2, 3].map(band => frames.reduce((sum, frame) => sum + frame.bands[band], 0) / frames.length),
    maxUpperPower: Math.max(...frames.map(frame => frame.bands[2] + frame.bands[3])),
  };
}

async function startAtLowEnergy(page: Page) {
  await installOutputProbe(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect((await audioState(page)).contexts).toBe(0);
  // Actual trusted clicks are essential: evaluate(start()) would not verify
  // browser autoplay/user-activation behavior.
  await openSettings(page);
  await page.getByRole('button', { name: '鼠标体验', exact: true }).click();
  await openSettings(page);
  await page.getByRole('slider', { name: '音量', exact: true }).fill('100');
  await page.locator('#energy-range').fill('0');
  await expect(page.locator('#energy-value')).toHaveText('0');
  await expect.poll(() => audioState(page)).toMatchObject({ contexts: 1, state: 'running', connections: 1 });
}

async function selectEffect(page: Page, effect: EffectName) {
  await page.locator(`#effect-${effect}`).click();
  await expect(page.locator('body')).toHaveAttribute('data-effect', effect);
  await expect(page.locator('#burst-button')).toBeEnabled();
}

test('both modes produce distinct real burst spectra above their baseline with safe full-volume peaks', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startAtLowEnergy(page);
  const measurements = {} as Record<EffectName, { baseline: Awaited<ReturnType<typeof captureOutput>>; burst: Awaited<ReturnType<typeof captureOutput>> }>;
  for (const [index, mode] of (['chidori', 'shuriken'] as const).entries()) {
    await selectEffect(page, mode);
    const baseline = await captureOutput(page, 700);
    const burst = await captureOutput(page, 800, () => page.locator('#burst-button').click());
    await expect(page.locator('#burst-count')).toHaveText(String(index + 1).padStart(3, '0'));
    measurements[mode] = { baseline, burst };
    expect(baseline.maxRms, `${mode}: continuous music should be audible`).toBeGreaterThan(0.001);
    expect(burst.maxRms, `${mode}: burst window should contain audible output`).toBeGreaterThan(0.001);
    // Music has unrelated bass/arp peaks. The effect occupies the upper bands,
    // so compare those against the baseline rather than requiring a wind
    // transient to exceed the loudest bass beat by an arbitrary RMS ratio.
    expect(burst.maxUpperPower, `${mode}: actual effect-band energy should rise`).toBeGreaterThan(baseline.maxUpperPower * 2);
    expect(burst.peak, `${mode}: full-volume output must remain limited`).toBeLessThan(0.7);
  }
  // Compare measured, baseline-subtracted spectral distributions, not just
  // selected UI attributes or which synthesis methods were called.
  const signature = (mode: EffectName) => {
    const { baseline, burst } = measurements[mode];
    const excess = burst.bands.map((power, band) => Math.max(0, power - baseline.bands[band]));
    return excess.map(power => power / excess.reduce((sum, value) => sum + value, 0));
  };
  const chidori = signature('chidori');
  const shuriken = signature('shuriken');
  const spectralDistance = chidori.reduce((sum, value, band) => sum + Math.abs(value - shuriken[band]), 0);
  console.log('REAL_BURST_AUDIO', JSON.stringify({
    modes: Object.fromEntries(Object.entries(measurements).map(([mode, { baseline, burst }]) => [mode, {
      baseline: { maxRms: baseline.maxRms, bands: baseline.bands, maxUpperPower: baseline.maxUpperPower },
      burst: { maxRms: burst.maxRms, peak: burst.peak, bands: burst.bands, maxUpperPower: burst.maxUpperPower },
    }])), chidori, shuriken, spectralDistance,
  }));
  expect(spectralDistance, 'electric and wind bursts must not be the same audible spectrum').toBeGreaterThan(0.2);
  await expect.poll(() => audioState(page)).toMatchObject({ contexts: 1, state: 'running', connections: 1 });
  expect(errors).toEqual([]);
  await testInfo.attach('real-effects-audio.json', {
    body: JSON.stringify({ measurements, signatures: { chidori, shuriken }, spectralDistance, errors }, null, 2), contentType: 'application/json',
  });
});

test('muted and zero-volume bursts stay silent in both modes and do not create extra audio contexts', async ({ page }, testInfo) => {
  await startAtLowEnergy(page);
  const measurements: Record<string, unknown> = {};
  let count = 0;
  for (const mode of ['chidori', 'shuriken'] as const) {
    await selectEffect(page, mode);
    for (const silence of ['mute', 'zero'] as const) {
      if (silence === 'mute') await page.getByRole('button', { name: '静音', exact: true }).click();
      else await page.getByRole('slider', { name: '音量', exact: true }).fill('0');
      // Poll the actual output until gain smoothing and old analyser samples
      // have drained before testing a new event while inaudible.
      await expect.poll(async () => (await captureOutput(page, 100)).peak, { timeout: 5000 }).toBeLessThan(0.00001);
      await expect(page.locator('#burst-button')).toBeEnabled();
      const output = await captureOutput(page, 650, () => page.locator('#burst-button').click());
      count++;
      await expect(page.locator('#burst-count')).toHaveText(String(count).padStart(3, '0'));
      expect(output.peak, `${mode}/${silence}: a consumed visual burst must remain inaudible`).toBeLessThan(0.00001);
      measurements[`${mode}/${silence}`] = output;
      if (silence === 'mute') await page.getByRole('button', { name: '开启声音', exact: true }).click();
      else await page.getByRole('slider', { name: '音量', exact: true }).fill('100');
      await expect.poll(async () => (await captureOutput(page, 100)).maxRms).toBeGreaterThan(0.001);
      await expect(page.locator('#burst-button')).toBeEnabled();
      await expect(page.locator('#burst-count')).toHaveText(String(count).padStart(3, '0'));
    }
  }
  expect(await audioState(page)).toEqual({ contexts: 1, state: 'running', connections: 1 });
  await testInfo.attach('silent-effects-audio.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('pausing during a burst drops its audio tail and resumes the same native context without a delayed burst', async ({ page }, testInfo) => {
  await startAtLowEnergy(page);
  const baseline = await captureOutput(page, 700);
  const audible = await captureOutput(page, 650, () => page.locator('#burst-button').click());
  await expect(page.locator('#burst-button')).toBeEnabled();
  await page.locator('#burst-button').click();
  await expect(page.locator('#burst-count')).toHaveText('002');
  // Exercise the production browser lifecycle listeners, not private engine
  // APIs. A native pagehide event models leaving/bfcaching this document.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect.poll(() => audioState(page)).toMatchObject({ contexts: 1, state: 'suspended' });
  await expect(page.getByRole('button', { name: '开启声音', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  const resumed = await captureOutput(page, 800, () => page.getByRole('button', { name: '开启声音', exact: true }).click());
  expect(await audioState(page)).toEqual({ contexts: 1, state: 'running', connections: 2 });
  await expect(page.locator('#burst-count')).toHaveText('002');
  expect(resumed.maxRms).toBeGreaterThan(0.001);
  expect(resumed.maxUpperPower, 'resumed music must not replay any part of the electric burst').toBeLessThan(audible.maxUpperPower * 0.3);
  expect(resumed.peak).toBeLessThan(0.7);
  await testInfo.attach('resumed-effects-audio.json', { body: JSON.stringify({ baseline, audible, resumed }, null, 2), contentType: 'application/json' });
});
