import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`camera-first stage fills ${viewport.width}×${viewport.height} with a compact reachable dock`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    for (const selector of ['#stage', '#camera', '#hand-overlay', '#lightning']) {
      const geometry = await page.locator(selector).evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      expect(geometry, `${selector} should share the viewport`).toEqual({ x: 0, y: 0, ...viewport });
    }
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(viewport);
    const dock = await page.locator('.control-dock').boundingBox();
    expect(dock!.height).toBeLessThanOrEqual(viewport.width < 760 ? 160 : 100);
    for (const selector of ['#camera-button', '#effect-chidori', '#effect-shuriken', '#burst-button', '#mute-button', '#settings-button']) {
      await expect(page.locator(selector)).toBeVisible();
      await expect(page.locator(selector)).toBeInViewport();
      const box = await page.locator(selector).boundingBox();
      expect(box!.height, `${selector} touch target`).toBeGreaterThanOrEqual(viewport.width < 760 ? 44 : 36);
    }
    await expect(page.locator('#effect-title')).toHaveText('千鸟');
    await expect(page.locator('#settings-panel')).toHaveCount(1);
    await expect(page.locator('#settings-panel')).toBeHidden();
    await expect(page.locator('#status-message')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`camera-stage-${viewport.width}x${viewport.height}.png`) });
  });

  test(`expanded settings stay above the dock at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('#settings-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: '鼠标体验', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '柔和模式', exact: true })).toHaveCount(1);
    for (const selector of ['#energy-range', '#volume-range']) {
      const box = await page.locator(selector).boundingBox();
      expect(box!.height, `${selector} input hit target`).toBeGreaterThanOrEqual(viewport.width < 760 ? 44 : 36);
    }
    const panel = await page.locator('#settings-panel').boundingBox();
    const dock = await page.locator('.control-dock').boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThan(dock!.y);
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
    const skeleton = page.getByRole('checkbox', { name: '显示手部骨架', exact: true });
    await skeleton.scrollIntoViewIfNeeded();
    await expect(skeleton).toBeInViewport();
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(viewport);
    await page.screenshot({ path: testInfo.outputPath(`camera-settings-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-panel')).toBeHidden();
    await expect(page.locator('#camera-button')).toBeInViewport();
  });
}

test('keyboard focus reaches settings controls directly after opening', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '鼠标体验', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();
});

test('camera and optional skeleton use the fullscreen shared-layer CSS contract', async ({ page }) => {
  await page.goto('/');
  const composition = await page.locator('#stage').evaluate(stage => {
    const camera = stage.querySelector('#camera')!;
    const landmarks = stage.querySelector('#hand-overlay')!;
    const effects = stage.querySelector('#lightning')!;
    return {
      directChildren: [camera, landmarks, effects].every(layer => layer.parentElement === stage),
      cameraFit: getComputedStyle(camera).objectFit,
      cameraPosition: getComputedStyle(camera).objectPosition,
      cameraMirror: getComputedStyle(camera).transform,
      cameraVisibility: getComputedStyle(camera).visibility,
      skeletonVisibility: getComputedStyle(landmarks).visibility,
      skeletonEvents: getComputedStyle(landmarks).pointerEvents,
      effectsEvents: getComputedStyle(effects).pointerEvents,
      layerOrder: [camera, landmarks, effects].map(layer => Number(getComputedStyle(layer).zIndex)),
    };
  });
  expect(composition).toMatchObject({ directChildren: true, cameraFit: 'cover', cameraPosition: '50% 50%', cameraMirror: 'matrix(-1, 0, 0, 1, 0, 0)', cameraVisibility: 'hidden', skeletonVisibility: 'hidden', skeletonEvents: 'none', effectsEvents: 'auto' });
  expect(composition.layerOrder[0]).toBeLessThan(composition.layerOrder[1]);
  expect(composition.layerOrder[1]).toBeLessThan(composition.layerOrder[2]);
  // Exercise the CSS contract without requesting a physical camera.
  await page.evaluate(() => document.body.classList.add('camera-active'));
  await expect(page.locator('#camera')).toBeVisible();
  await expect(page.locator('#hand-overlay')).toBeHidden();
  await page.evaluate(() => document.body.classList.add('show-landmarks'));
  await expect(page.locator('#hand-overlay')).toBeVisible();
  await page.evaluate(() => document.body.classList.remove('camera-active'));
  await expect(page.locator('#camera')).toBeHidden();
  await expect(page.locator('#hand-overlay')).toBeHidden();
});

test('camera permission errors remain visible outside the collapsed settings', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开启手势', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText(/权限|允许/, { timeout: 25000 });
  await expect(page.locator('#status-message')).toBeVisible();
  await expect(page.locator('#settings-panel')).toHaveCount(1);
  await expect(page.locator('#settings-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: '开启手势', exact: true })).toBeVisible();
});
