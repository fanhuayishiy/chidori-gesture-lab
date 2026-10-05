import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installFixtureCamera } from './helpers/fixture-camera';

/** Observe actual animation/UI ticks rather than sleeping and guessing their phase. */
async function observeBurst(page: Page, refresh: boolean, capture = false) {
  return page.evaluate(({ refresh, capture }) => new Promise<{
    samples: { at: number; active: boolean; count: string; disabled: boolean; image?: string }[];
    finishedAt: number;
    activeAtEnd: boolean;
  }>(resolve => {
    const button = document.querySelector('#burst-button') as HTMLButtonElement;
    const canvas = document.querySelector('#lightning') as HTMLCanvasElement;
    const video = document.querySelector('#camera') as HTMLVideoElement;
    const samples: { at: number; active: boolean; count: string; disabled: boolean; image?: string }[] = [];
    const milestones = refresh ? [100, 900, 1300, 2800, 3900] : [100, 1100, 2000, 2800];
    // The first click may await AudioContext unlock before emitting the burst.
    // Measure from the actual event's DOM update, not from the earlier click.
    let started: number | null = null;
    const events = new MutationObserver(() => {
      if (started === null && document.querySelector('#burst-count')!.textContent === '001') started = performance.now();
    });
    events.observe(document.querySelector('#burst-count')!, { childList: true });
    let refreshed = false;
    button.click();
    const observe = () => {
      if (started === null) { requestAnimationFrame(observe); return; }
      const elapsed = performance.now() - started;
      if (refresh && !refreshed && elapsed >= 1200 && !button.disabled) {
        button.click();
        refreshed = true;
      }
      if (samples.length < milestones.length && elapsed >= milestones[samples.length]) {
        const sample: typeof samples[number] = {
          at: elapsed, active: document.body.classList.contains('bursting'),
          count: document.querySelector('#burst-count')!.textContent!, disabled: button.disabled,
        };
        if (capture) {
          // Reproduce the two visible layers without ever recording the physical camera.
          const composite = document.createElement('canvas');
          composite.width = innerWidth; composite.height = innerHeight;
          const ctx = composite.getContext('2d')!;
          const scale = Math.max(innerWidth / video.videoWidth, innerHeight / video.videoHeight);
          const width = video.videoWidth * scale, height = video.videoHeight * scale;
          ctx.translate(innerWidth, 0); ctx.scale(-1, 1);
          ctx.drawImage(video, (innerWidth - width) / 2, (innerHeight - height) / 2, width, height);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(canvas, 0, 0, innerWidth, innerHeight);
          sample.image = composite.toDataURL('image/png');
        }
        samples.push(sample);
      }
      const endpoint = refresh ? 4500 : 3300;
      if (elapsed < endpoint) { requestAnimationFrame(observe); return; }
      events.disconnect();
      resolve({ samples, finishedAt: elapsed, activeAtEnd: document.body.classList.contains('bursting') });
    };
    requestAnimationFrame(observe);
  }), { refresh, capture });
}

for (const mode of ['千鸟', '旋风手里剑'] as const) {
  test(`${mode} stays active through the three-second burst and returns to idle`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new Error('Physical camera forbidden'); };
    });
    await page.goto('/');
    await page.getByRole('button', { name: mode, exact: true }).click();
    const result = await observeBurst(page, false);
    expect(result.samples).toHaveLength(4);
    expect(result.samples.every(sample => sample.active && sample.count === '001')).toBe(true);
    expect(result.samples[0].disabled).toBe(true);
    expect(result.samples[1].disabled).toBe(false);
    expect(result.activeAtEnd).toBe(false);
    expect(errors).toEqual([]);
  });

  test(`${mode} can refresh while its old tail is still active`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: mode, exact: true }).click();
    const result = await observeBurst(page, true);
    expect(result.samples.map(sample => sample.count)).toEqual(['001', '001', '002', '002', '002']);
    expect(result.samples.every(sample => sample.active)).toBe(true);
    expect(result.activeAtEnd).toBe(false);
  });

  test(`${mode} captures synthetic-camera layers across the burst lifecycle for visual inspection`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 960, height: 720 });
    await installFixtureCamera(page);
    await page.goto('/');
    await page.evaluate(() => window.__effectsCamera.switchTo('open'));
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: '开启手势', exact: true }).click();
    await expect(page.locator('#tracking-badge')).toHaveText('LIVE', { timeout: 45_000 });
    await expect(page.locator('#hand-count')).toHaveText('1 / 2', { timeout: 15_000 });
    const result = await observeBurst(page, false, true);
    expect(result.samples.every(sample => sample.active && sample.count === '001')).toBe(true);
    expect(result.activeAtEnd).toBe(false);
    await expect(page.locator('body')).toHaveClass(/camera-active/);
    await expect(page.locator('#settings-panel')).toBeHidden();
    const prefix = mode === '千鸟' ? 'chidori' : 'shuriken';
    await mkdir('docs/evidence', { recursive: true });
    for (const [index, sample] of result.samples.entries()) {
      expect(sample.image).toMatch(/^data:image\/png;base64,/);
      await writeFile(`docs/evidence/long-burst-${prefix}-${[100, 1100, 2000, 2800][index]}ms.png`,
        Buffer.from(sample.image!.split(',')[1], 'base64'));
    }
    await page.getByRole('button', { name: '停止手势', exact: true }).click();
  });
}
