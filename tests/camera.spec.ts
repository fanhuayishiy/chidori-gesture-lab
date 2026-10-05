import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openSettings } from './helpers/settings';

type FixtureName = 'palms' | 'fist' | 'blank';

declare global {
  interface Window {
    __fixtureCamera: {
      canvas: HTMLCanvasElement;
      context: CanvasRenderingContext2D;
      streams: MediaStream[];
      requests: (MediaStreamConstraints | undefined)[];
      switchTo: (name: FixtureName) => void;
    };
  }
}

test('real VIDEO inference follows a fixture camera through palms, fist, absence, stop and mode switch', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  const imageSources = {
    palms: `data:image/jpeg;base64,${(await readFile(new URL('./fixtures/right_hands.jpg', import.meta.url))).toString('base64')}`,
    fist: `data:image/jpeg;base64,${(await readFile(new URL('./fixtures/fist.jpg', import.meta.url))).toString('base64')}`,
  };
  const browserErrors: string[] = [];
  const runtimeMessages: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (/delegate|GPU|CPU|WebGL|GL version|Graph.*start/i.test(message.text())) runtimeMessages.push(message.text());
  });
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== appOrigin) externalRequests.push(request.url());
  });

  // Only replace the physical camera source. The app, VIDEO HandLandmarker,
  // local model, WASM, production CPU delegate, gesture math, renderer and UI are real.
  await page.addInitScript(async (sources) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    const images = { palms: new Image(), fist: new Image() };
    images.palms.src = sources.palms;
    images.fist.src = sources.fist;
    const loaded = Promise.all([images.palms.decode(), images.fist.decode()]);
    let selected: FixtureName = 'palms';
    let frameNumber = 0;
    const draw = () => {
      context.fillStyle = '#ededed';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (selected !== 'blank') {
        const image = images[selected];
        if (image.complete && image.naturalWidth > 0) {
          const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        }
      }
      // A changing corner pixel ensures a fresh encoded canvas frame even
      // while the hand image itself is unchanged.
      context.fillStyle = (++frameNumber % 2) ? '#eeeeee' : '#ededed';
      context.fillRect(0, 0, 1, 1);
    };
    const fixtureCamera = {
      canvas, context,
      streams: [] as MediaStream[],
      requests: [] as (MediaStreamConstraints | undefined)[],
      switchTo: (name: FixtureName) => { selected = name; draw(); },
    };
    window.__fixtureCamera = fixtureCamera;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints?: MediaStreamConstraints) => {
        fixtureCamera.requests.push(constraints);
        await loaded;
        draw();
        const stream = canvas.captureStream(30);
        fixtureCamera.streams.push(stream);
        return stream;
      },
    });
    await loaded;
    draw();
    const drawing = window.setInterval(draw, 1000 / 30);
    window.addEventListener('pagehide', () => window.clearInterval(drawing), { once: true });
  }, imageSources);

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: '开启手势', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开启手势', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('手势控制', { timeout: 45_000 });
  await expect(page.locator('#tracking-badge')).toHaveText('LIVE');
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  await expect.poll(async () => Number(await page.locator('#energy-value').textContent()), { timeout: 15_000 }).toBeGreaterThan(75);
  const palmEnergy = Number(await page.locator('#energy-value').textContent());
  const performanceSample = await page.evaluate(() => new Promise<{ sampleMs: number; animationFps: number; p95FrameMs: number; deliveredVideoFrames: number }>((resolve) => {
    const video = document.querySelector('#camera') as HTMLVideoElement;
    const started = performance.now();
    const videoFramesBefore = video.getVideoPlaybackQuality().totalVideoFrames;
    let previous = started;
    const intervals: number[] = [];
    const sample = (now: number) => {
      intervals.push(now - previous);
      previous = now;
      if (now - started < 1500) { requestAnimationFrame(sample); return; }
      const sorted = [...intervals].sort((a, b) => a - b);
      resolve({
        sampleMs: Math.round(now - started),
        animationFps: Math.round(intervals.length / (now - started) * 1000),
        p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
        deliveredVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames - videoFramesBefore,
      });
    };
    requestAnimationFrame(sample);
  }));
  await testInfo.attach('synthetic-camera-palms.png', { body: await page.screenshot(), contentType: 'image/png' });

  await page.evaluate(() => window.__fixtureCamera.switchTo('fist'));
  await expect(page.locator('#hand-count')).toHaveText('1 / 2', { timeout: 15_000 });
  await expect.poll(async () => Number(await page.locator('#energy-value').textContent()), { timeout: 15_000 }).toBeLessThan(15);
  const fistEnergy = Number(await page.locator('#energy-value').textContent());
  await expect(page.locator('#state-label')).toHaveText('掌心聚合');
  await testInfo.attach('synthetic-camera-fist.png', { body: await page.screenshot(), contentType: 'image/png' });

  // First re-expand so absence checks prove decay rather than merely observing
  // the already contracted fist state.
  await page.evaluate(() => window.__fixtureCamera.switchTo('palms'));
  await expect.poll(async () => Number(await page.locator('#energy-value').textContent()), { timeout: 15_000 }).toBeGreaterThan(75);
  await page.evaluate(() => window.__fixtureCamera.switchTo('blank'));
  await expect(page.locator('#hand-count')).toHaveText('0 / 2', { timeout: 15_000 });
  await expect(page.locator('#state-label')).toHaveText('等待手掌', { timeout: 15_000 });
  await expect.poll(async () => Number(await page.locator('#energy-value').textContent()), { timeout: 15_000 }).toBeLessThan(15);
  const absentEnergy = Number(await page.locator('#energy-value').textContent());

  await page.getByRole('button', { name: '停止手势', exact: true }).click();
  await expect(page.locator('#tracking-badge')).toHaveText('STANDBY');
  await expect(page.locator('#mode-label')).toHaveText('待机演示');
  expect(await page.evaluate(() => window.__fixtureCamera.streams[0].getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  expect(await page.locator('#camera').evaluate((video) => (video as HTMLVideoElement).srcObject)).toBeNull();

  await page.evaluate(() => window.__fixtureCamera.switchTo('palms'));
  await page.getByRole('button', { name: '开启手势', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('手势控制', { timeout: 45_000 });
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  await openSettings(page);
  await page.getByRole('button', { name: '鼠标体验', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('鼠标控制');
  await expect(page.locator('#tracking-badge')).toHaveText('STANDBY');
  const cameraLifecycle = await page.evaluate(() => ({
    requests: window.__fixtureCamera.requests,
    streamTracks: window.__fixtureCamera.streams.map((stream) => stream.getTracks().map((track) => track.readyState)),
    videoDetached: (document.querySelector('#camera') as HTMLVideoElement).srcObject === null,
  }));
  expect(cameraLifecycle.streamTracks).toHaveLength(2);
  expect(cameraLifecycle.streamTracks.every((tracks) => tracks.length > 0 && tracks.every((state) => state === 'ended'))).toBe(true);
  expect(cameraLifecycle.videoDetached).toBe(true);
  expect(cameraLifecycle.requests.every((request) => request?.audio === false)).toBe(true);
  expect(browserErrors).toEqual([]);
  expect(externalRequests).toEqual([]);

  const evidence = { source: 'public fixtures via canvas.captureStream, not a physical camera', palmEnergy, fistEnergy, absentEnergy, performanceSample, runtimeMessages, cameraLifecycle };
  console.log('ACTUAL_VIDEO_PIPELINE', JSON.stringify(evidence));
  await testInfo.attach('actual-video-pipeline.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});
