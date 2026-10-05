import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

export type CameraPose = 'two-hands' | 'fist' | 'fist-left' | 'open' | 'blank';

declare global {
  interface Window {
    __effectsCamera: {
      streams: MediaStream[];
      requests: (MediaStreamConstraints | undefined)[];
      selectedAt: number;
      switchTo: (pose: CameraPose) => void;
    };
  }
}

/** Replace only the physical camera source; model, WASM and VIDEO inference stay real. */
export async function installFixtureCamera(page: Page): Promise<void> {
  const sources = {
    palms: `data:image/jpeg;base64,${(await readFile(new URL('../fixtures/right_hands.jpg', import.meta.url))).toString('base64')}`,
    fist: `data:image/jpeg;base64,${(await readFile(new URL('../fixtures/fist.jpg', import.meta.url))).toString('base64')}`,
  };
  await page.addInitScript(async (imagesSource) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    const images = { palms: new Image(), fist: new Image() };
    images.palms.src = imagesSource.palms;
    images.fist.src = imagesSource.fist;
    const loaded = Promise.all([images.palms.decode(), images.fist.decode()]);
    let selected: CameraPose = 'two-hands';
    let frameNumber = 0;
    const draw = () => {
      context.fillStyle = '#ededed';
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (selected !== 'blank') {
        const image = selected === 'fist' || selected === 'fist-left' ? images.fist : images.palms;
        if (image.complete && image.naturalWidth > 0) {
          // The 720×382 palm fixture has TWO hands. The right-hand crop starts
          // beyond the left hand's thumb; use a source crop, never a fake reading.
          const sourceX = selected === 'open' ? 350 : 0;
          const sourceWidth = image.naturalWidth - sourceX;
          const sourceHeight = image.naturalHeight;
          const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight) * (selected === 'fist-left' ? .55 : 1);
          const width = sourceWidth * scale;
          const height = sourceHeight * scale;
          context.drawImage(image, sourceX, 0, sourceWidth, sourceHeight,
            selected === 'fist-left' ? 8 : (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        }
      }
      // Ensure a fresh encoded frame even while the photographed pose is held.
      context.fillStyle = (++frameNumber % 2) ? '#eeeeee' : '#ededed';
      context.fillRect(0, 0, 1, 1);
    };
    const fixture = {
      streams: [] as MediaStream[],
      requests: [] as (MediaStreamConstraints | undefined)[],
      selectedAt: performance.now(),
      switchTo: (pose: CameraPose) => {
        selected = pose;
        fixture.selectedAt = performance.now();
        draw();
      },
    };
    window.__effectsCamera = fixture;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints?: MediaStreamConstraints) => {
        fixture.requests.push(constraints);
        await loaded;
        draw();
        const stream = canvas.captureStream(30);
        fixture.streams.push(stream);
        return stream;
      },
    });
    await loaded;
    draw();
    const drawing = window.setInterval(draw, 1000 / 30);
    window.addEventListener('pagehide', () => window.clearInterval(drawing), { once: true });
  }, sources);
}

export async function cameraLifecycle(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector('#camera') as HTMLVideoElement;
    return {
      requestCount: window.__effectsCamera.requests.length,
      audioRequested: window.__effectsCamera.requests.some(request => request?.audio !== false),
      streamIds: window.__effectsCamera.streams.map(stream => stream.id),
      trackStates: window.__effectsCamera.streams.map(stream => stream.getTracks().map(track => track.readyState)),
      attachedStreamId: (video.srcObject as MediaStream | null)?.id ?? null,
      live: document.querySelector('#tracking-badge')!.textContent,
      mode: document.querySelector('#mode-label')!.textContent,
    };
  });
}

/** An intentional observation window beyond the 1000ms cooldown, not a settling sleep. */
export async function observeStableBurst(page: Page, expectedCount: string, minimumMs = 1250) {
  return page.evaluate(({ expectedCount, minimumMs }) => new Promise<{
    durationMs: number; deliveredVideoFrames: number; samples: number; burstCounts: string[];
  }>((resolve, reject) => {
    const video = document.querySelector('#camera') as HTMLVideoElement;
    const started = performance.now();
    const framesBefore = video.getVideoPlaybackQuality().totalVideoFrames;
    const counts = new Set<string>();
    let samples = 0;
    const observe = () => {
      const count = document.querySelector('#burst-count')!.textContent!;
      counts.add(count);
      samples++;
      if (count !== expectedCount) {
        reject(new Error(`Unexpected burst during held pose: expected ${expectedCount}, saw ${count}`));
        return;
      }
      const elapsed = performance.now() - started;
      const deliveredVideoFrames = video.getVideoPlaybackQuality().totalVideoFrames - framesBefore;
      // Shared CPU inference can deliver fewer frames during a busy run. Observe
      // actual progress as well as elapsed cooldown, rather than asserting an FPS.
      if (elapsed < minimumMs || deliveredVideoFrames < 6) { requestAnimationFrame(observe); return; }
      resolve({ durationMs: elapsed, deliveredVideoFrames,
        samples, burstCounts: [...counts] });
    };
    requestAnimationFrame(observe);
  }), { expectedCount, minimumMs });
}
