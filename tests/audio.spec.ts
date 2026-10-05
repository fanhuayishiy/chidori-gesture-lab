import { expect, test, type Page } from '@playwright/test';
import { openSettings } from './helpers/settings';

interface AudioProbe {
  context: AudioContext;
  analyser: AnalyserNode;
  tapped: boolean;
}

declare global {
  interface Window {
    __audioProbes: AudioProbe[];
  }
}

async function readOutput(page: Page) {
  return page.evaluate(() => {
    const probes = window.__audioProbes;
    const probe = probes[0];
    if (!probe) return { contexts: 0, state: 'missing', tapped: false, rms: 0, peak: 0 };
    const samples = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(samples);
    let squares = 0;
    let peak = 0;
    for (const sample of samples) {
      squares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return {
      contexts: probes.length,
      state: probe.context.state,
      tapped: probe.tapped,
      rms: Math.sqrt(squares / samples.length),
      peak,
    };
  });
}

test('real audio output follows demo, volume and mute controls without duplicate contexts', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__audioProbes = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const analyser = this.createAnalyser();
        analyser.fftSize = 4096;
        window.__audioProbes.push({ context: this, analyser, tapped: false });
      }
    };

    // Tap the real destination feed in parallel. The app's destination, gain,
    // compressor, scheduler and native audio connection all remain unchanged.
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const result = Reflect.apply(connect, this, args);
      if (args[0] === this.context.destination) {
        const probe = window.__audioProbes.find(candidate => candidate.context === this.context);
        if (probe && !probe.tapped) {
          Reflect.apply(connect, this, [probe.analyser]);
          probe.tapped = true;
        }
      }
      return result;
    } as typeof AudioNode.prototype.connect;
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const demo = page.getByRole('button', { name: '鼠标体验', exact: true });
  const volume = page.getByRole('slider', { name: '音量', exact: true });
  await openSettings(page);
  await expect(demo).toBeVisible();
  await expect(volume).toHaveValue('35');
  expect((await readOutput(page)).contexts).toBe(0);

  // A trusted UI click, not page.evaluate(audio.start()), must unlock playback.
  await demo.click();
  await expect(page.locator('#mode-label')).toHaveText('鼠标控制');
  await expect.poll(() => readOutput(page)).toMatchObject({ contexts: 1, state: 'running', tapped: true });
  await expect.poll(async () => (await readOutput(page)).rms, { timeout: 5000 }).toBeGreaterThan(0.001);
  const playing = await readOutput(page);
  expect(playing.peak).toBeLessThan(0.65);

  await openSettings(page);
  await volume.fill('0');
  await expect(page.locator('#volume-value')).toHaveText('0%');
  await expect.poll(async () => (await readOutput(page)).rms, { timeout: 5000 }).toBeLessThan(0.00001);
  const zeroVolume = await readOutput(page);
  expect(zeroVolume.state).toBe('running');

  await volume.fill('35');
  await expect(page.locator('#volume-value')).toHaveText('35%');
  await expect.poll(async () => (await readOutput(page)).rms, { timeout: 5000 }).toBeGreaterThan(0.001);

  await page.getByRole('button', { name: '静音', exact: true }).click();
  const unmute = page.getByRole('button', { name: '开启声音', exact: true });
  await expect(unmute).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readOutput(page)).rms, { timeout: 5000 }).toBeLessThan(0.00001);
  const muted = await readOutput(page);
  expect(muted.state).toBe('running');
  await expect(volume).toHaveValue('35');

  await unmute.click();
  await expect(page.getByRole('button', { name: '静音', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readOutput(page)).rms, { timeout: 5000 }).toBeGreaterThan(0.001);
  await demo.click();
  await openSettings(page);
  await demo.click();
  await openSettings(page);
  await expect.poll(() => readOutput(page)).toMatchObject({ contexts: 1, state: 'running', tapped: true });
  await expect(volume).toHaveValue('35');
  await expect.poll(async () => (await readOutput(page)).rms, { timeout: 5000 }).toBeGreaterThan(0.001);
  const restored = await readOutput(page);
  expect(errors).toEqual([]);

  await testInfo.attach('audio-output-measurements', {
    body: JSON.stringify({ playing, zeroVolume, muted, restored, errors }, null, 2),
    contentType: 'application/json',
  });
});
