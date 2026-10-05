import { expect, test, type Page } from '@playwright/test';
import { cameraLifecycle, installFixtureCamera, observeStableBurst } from './helpers/fixture-camera';
import { openSettings } from './helpers/settings';

const armedLabel = '蓄力 · 展开释放';

async function startCamera(page: Page) {
  await page.getByRole('button', { name: '开启手势', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('手势控制', { timeout: 45_000 });
  await expect(page.locator('#tracking-badge')).toHaveText('LIVE');
}

async function holdSingleFist(page: Page) {
  await page.evaluate(() => window.__effectsCamera.switchTo('fist'));
  await expect(page.locator('#hand-count')).toHaveText('1 / 2', { timeout: 15_000 });
  await expect.poll(async () => Number(await page.locator('#energy-value').textContent()), { timeout: 15_000 }).toBeLessThan(15);
  await expect(page.locator('#charge-label')).toHaveText(armedLabel, { timeout: 15_000 });
  const heldMs = await page.evaluate(() => performance.now() - window.__effectsCamera.selectedAt);
  expect(heldMs).toBeGreaterThanOrEqual(300);
  return heldMs;
}

async function expectSingleOpen(page: Page) {
  await expect(page.locator('#hand-count')).toHaveText('1 / 2', { timeout: 15_000 });
  await expect.poll(async () => Number(await page.locator('#energy-value').textContent()), { timeout: 15_000 }).toBeGreaterThan(75);
}

test('real VIDEO single-fist charge releases exactly once in each effect without restarting the camera', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await installFixtureCamera(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#burst-count')).toHaveText('000');
  await startCamera(page);
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  const initialCamera = await cameraLifecycle(page);
  expect(initialCamera.requestCount).toBe(1);
  expect(initialCamera.trackStates).toEqual([['live']]);
  expect(initialCamera.attachedStreamId).toBe(initialCamera.streamIds[0]);
  const evidence = [];

  for (const [index, effect] of ['chidori', 'shuriken'].entries()) {
    await page.locator(`#effect-${effect}`).click();
    await expect(page.locator('body')).toHaveAttribute('data-effect', effect);
    await expect(page.locator(`#effect-${effect}`)).toHaveAttribute('aria-pressed', 'true');
    expect(await cameraLifecycle(page)).toEqual(initialCamera);
    const heldMs = await holdSingleFist(page);
    await expect(page.locator('#burst-count')).toHaveText(String(index).padStart(3, '0'));
    await page.evaluate(() => window.__effectsCamera.switchTo('open'));
    await expectSingleOpen(page);
    const count = String(index + 1).padStart(3, '0');
    await expect(page.locator('#burst-count')).toHaveText(count, { timeout: 15_000 });
    const observation = await observeStableBurst(page, count);
    expect(observation.deliveredVideoFrames).toBeGreaterThan(5);
    await expect(page.locator('#burst-button')).toBeEnabled();
    await expect(page.locator('#charge-label')).toHaveText('能量就绪');
    expect(await cameraLifecycle(page)).toEqual(initialCamera);
    evidence.push({ effect, heldMs, observation });
  }

  await page.getByRole('button', { name: '停止手势', exact: true }).click();
  await expect(page.locator('#tracking-badge')).toHaveText('STANDBY');
  const stoppedCamera = await cameraLifecycle(page);
  expect(stoppedCamera.trackStates).toEqual([['ended']]);
  expect(stoppedCamera.attachedStreamId).toBeNull();
  expect(stoppedCamera.audioRequested).toBe(false);
  expect(errors).toEqual([]);
  const origin = new URL(String(testInfo.project.use.baseURL)).origin;
  expect(requests.filter(url => new URL(url).origin !== origin)).toEqual([]);
  expect(requests.some(url => new URL(url).pathname === '/models/hand_landmarker.task')).toBe(true);
  expect(requests.some(url => new URL(url).pathname.endsWith('.wasm'))).toBe(true);
  await testInfo.attach('effects-real-video-release.json', {
    body: JSON.stringify({ source: 'canvas.captureStream with photographed poses; real model/WASM/VIDEO inference',
      initialCamera, evidence, stoppedCamera, requests, errors }, null, 2), contentType: 'application/json',
  });
});

test('returning two hands cancels a real VIDEO single-hand arm without releasing', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtureCamera(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await startCamera(page);
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  const initialCamera = await cameraLifecycle(page);
  const observations = [];

  await holdSingleFist(page);
  const handCountTransition = await page.evaluate(() => new Promise<Array<{ timeMs: number; hands: string | null; bursts: string | null; energy: string | null }>>(resolve => {
    const started = performance.now();
    const samples: Array<{ timeMs: number; hands: string | null; bursts: string | null; energy: string | null }> = [];
    let previous = '';
    const observe = () => {
      const hands = document.querySelector('#hand-count')!.textContent;
      const bursts = document.querySelector('#burst-count')!.textContent;
      const energy = document.querySelector('#energy-value')!.textContent;
      const key = `${hands}/${bursts}/${energy}`;
      if (key !== previous) {
        samples.push({ timeMs: performance.now() - started, hands, bursts, energy });
        previous = key;
      }
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.querySelector('#hand-count')!, { childList: true });
    observer.observe(document.querySelector('#burst-count')!, { childList: true });
    observer.observe(document.querySelector('#energy-value')!, { childList: true });
    observe();
    window.__effectsCamera.switchTo('two-hands');
    const finish = () => {
      if (performance.now() - started < 1250) { requestAnimationFrame(finish); return; }
      observer.disconnect();
      resolve(samples);
    };
    requestAnimationFrame(finish);
  }));
  console.log('HAND_COUNT_TRANSITION', JSON.stringify(handCountTransition));
  await testInfo.attach('hand-count-transition.json', { body: JSON.stringify(handCountTransition, null, 2), contentType: 'application/json' });
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
  await expect(page.locator('#burst-count')).toHaveText('000');
  await page.evaluate(() => window.__effectsCamera.switchTo('open'));
  await expectSingleOpen(page);
  observations.push({ cancellation: 'one-to-two hands', observation: await observeStableBurst(page, '000') });
  expect(await cameraLifecycle(page)).toEqual(initialCamera);
  await page.getByRole('button', { name: '停止手势', exact: true }).click();
  expect((await cameraLifecycle(page)).trackStates).toEqual([['ended']]);
  expect(errors).toEqual([]);
  await testInfo.attach('effects-real-video-hand-count-reset.json', {
    body: JSON.stringify({ initialCamera, observations, handCountTransition, errors }, null, 2), contentType: 'application/json',
  });
});

test('effect switches, mouse mode and stop cancel a real VIDEO gesture arm', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtureCamera(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await startCamera(page);
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  const initialCamera = await cameraLifecycle(page);
  const observations = [];

  await holdSingleFist(page);
  // Change the UI mode and photographed pose in the same task. This avoids
  // inadvertently holding the old fist for another 300ms and legitimately rearming.
  await page.locator('#effect-shuriken').evaluate(button => {
    (button as HTMLButtonElement).click();
    window.__effectsCamera.switchTo('open');
  });
  await expect(page.locator('body')).toHaveAttribute('data-effect', 'shuriken');
  await expectSingleOpen(page);
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
  observations.push({ cancellation: 'effect switch', observation: await observeStableBurst(page, '000') });
  expect(await cameraLifecycle(page)).toEqual(initialCamera);

  await openSettings(page);
  await holdSingleFist(page);
  await page.getByRole('button', { name: '鼠标体验', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('鼠标控制');
  await expect(page.locator('#tracking-badge')).toHaveText('STANDBY');
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
  const mouseCamera = await cameraLifecycle(page);
  expect(mouseCamera.trackStates).toEqual([['ended']]);
  expect(mouseCamera.attachedStreamId).toBeNull();
  await page.evaluate(() => window.__effectsCamera.switchTo('open'));
  await startCamera(page);
  await expectSingleOpen(page);
  observations.push({ cancellation: 'mouse mode and restart', observation: await observeStableBurst(page, '000') });

  await holdSingleFist(page);
  await page.getByRole('button', { name: '停止手势', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('待机演示');
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
  const stoppedCamera = await cameraLifecycle(page);
  expect(stoppedCamera.trackStates).toEqual([['ended'], ['ended']]);
  expect(stoppedCamera.attachedStreamId).toBeNull();
  await page.evaluate(() => window.__effectsCamera.switchTo('open'));
  await startCamera(page);
  await expectSingleOpen(page);
  observations.push({ cancellation: 'stop and restart', observation: await observeStableBurst(page, '000') });
  await page.getByRole('button', { name: '停止手势', exact: true }).click();
  const finalCamera = await cameraLifecycle(page);
  expect(finalCamera.requestCount).toBe(3);
  expect(finalCamera.trackStates).toEqual([['ended'], ['ended'], ['ended']]);
  expect(finalCamera.attachedStreamId).toBeNull();
  expect(finalCamera.audioRequested).toBe(false);
  for (const { observation } of observations) expect(observation.deliveredVideoFrames).toBeGreaterThan(5);
  expect(errors).toEqual([]);
  await testInfo.attach('effects-real-video-cancellation.json', {
    body: JSON.stringify({ initialCamera, observations, mouseCamera, stoppedCamera, finalCamera, errors }, null, 2),
    contentType: 'application/json',
  });
});

test('window blur prevents active VIDEO callbacks from rearming until focus returns', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtureCamera(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await startCamera(page);
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  const initialCamera = await cameraLifecycle(page);
  await holdSingleFist(page);

  // Blur alone does not hide the document or stop the fixture video. Continuing
  // real inference must not silently recreate the arm that blur just cancelled.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurredFist = await observeStableBurst(page, '000');
  const blurredState = await page.evaluate(() => ({
    charge: document.querySelector('#charge-label')!.textContent,
    bursts: document.querySelector('#burst-count')!.textContent,
    hands: document.querySelector('#hand-count')!.textContent,
  }));
  console.log('CAMERA_BLUR_HELD_FIST', JSON.stringify({ blurredFist, blurredState }));
  await testInfo.attach('camera-blur-held-fist.json', {
    body: JSON.stringify({ blurredFist, blurredState }, null, 2), contentType: 'application/json',
  });
  expect(await cameraLifecycle(page)).toEqual(initialCamera);
  await page.evaluate(() => window.__effectsCamera.switchTo('open'));
  await expectSingleOpen(page);
  const blurredOpen = await observeStableBurst(page, '000');
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
  expect(await cameraLifecycle(page)).toEqual(initialCamera);

  // Recover while already open, then require a NEW low hold before any release.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#burst-count')).toHaveText('000');
  await holdSingleFist(page);
  await page.evaluate(() => window.__effectsCamera.switchTo('open'));
  await expectSingleOpen(page);
  await expect(page.locator('#burst-count')).toHaveText('001', { timeout: 15_000 });
  const focusedOpen = await observeStableBurst(page, '001');
  expect(await cameraLifecycle(page)).toEqual(initialCamera);
  await page.getByRole('button', { name: '停止手势', exact: true }).click();
  const finalCamera = await cameraLifecycle(page);
  expect(finalCamera.requestCount).toBe(1);
  expect(finalCamera.trackStates).toEqual([['ended']]);
  expect(finalCamera.attachedStreamId).toBeNull();
  expect(finalCamera.audioRequested).toBe(false);
  expect(errors).toEqual([]);
  await testInfo.attach('effects-real-video-blur-recovery.json', {
    body: JSON.stringify({ initialCamera, blurredFist, blurredState, blurredOpen, focusedOpen, finalCamera, errors }, null, 2),
    contentType: 'application/json',
  });
});
