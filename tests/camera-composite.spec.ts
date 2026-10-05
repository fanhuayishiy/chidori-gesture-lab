import { expect, test } from '@playwright/test';
import { cameraLifecycle, installFixtureCamera, observeStableBurst } from './helpers/fixture-camera';

test('effect canvas supports transparent camera compositing', async ({ page }) => {
  await page.goto('/');
  const alpha = await page.locator('#lightning').evaluate(node =>
    (node as HTMLCanvasElement).getContext('2d')!.getContextAttributes().alpha);
  expect(alpha).toBe(true);
});

test('settings are collapsed by default and Escape restores toggle focus', async ({ page }) => {
  await page.goto('/');
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#settings-panel')).toBeHidden();
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('slider', { name: '音量', exact: true })).toBeVisible();
  await page.getByRole('slider', { name: '音量', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-panel')).toBeHidden();
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#lightning').focus();
  for(let i=0;i<12;i++){
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#settings-panel') !== null)).toBe(false);
  }
});

test('opening settings cancels a held manual charge and prevents hidden canvas charging', async ({ page }) => {
  await page.goto('/');
  const settings=page.getByRole('button',{name:'设置',exact:true});
  await settings.click();
  await page.getByRole('button',{name:'鼠标体验',exact:true}).click();
  await page.keyboard.down('Space');
  await expect(page.locator('#state-label')).toHaveText('蓄力中');
  await settings.click();
  await page.keyboard.up('Space');
  await expect(page.locator('#burst-count')).toHaveText('000');
  await page.locator('#lightning').focus();
  await page.keyboard.down('Space');
  await settings.click();
  await page.keyboard.up('Space');
  await expect(page.locator('#burst-count')).toHaveText('000');
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
});

test('resizing a paused real camera reprojects cached palms without arming outside the crop', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({width:640,height:480});
  await installFixtureCamera(page);
  await page.goto('/');
  await page.evaluate(()=>window.__effectsCamera.switchTo('fist-left'));
  await page.getByRole('button',{name:'开启手势',exact:true}).click();
  await expect(page.locator('#tracking-badge')).toHaveText('LIVE',{timeout:45_000});
  await expect(page.locator('#hand-count')).toHaveText('1 / 2',{timeout:15_000});
  await expect(page.locator('#charge-label')).toHaveText('蓄力 · 展开释放',{timeout:15_000});
  const stoppedAt=await page.locator('#camera').evaluate(node=>{
    const video=node as HTMLVideoElement;video.pause();return video.currentTime;
  });
  // A 4:3 camera's left-side palm is no longer in a tall portrait cover crop.
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#hand-count')).toHaveText('0 / 2');
  // Hand status updates on resize; the charge label is throttled to the next 80ms UI tick.
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
  const observation=await page.evaluate(()=>new Promise<{labels:string[],bursts:string[],time:number}>(resolve=>{
    const labels=new Set<string>(),bursts=new Set<string>(),start=performance.now();
    const sample=()=>{
      labels.add(document.querySelector('#charge-label')!.textContent!);
      bursts.add(document.querySelector('#burst-count')!.textContent!);
      if(performance.now()-start<800){requestAnimationFrame(sample);return;}
      resolve({labels:[...labels],bursts:[...bursts],time:(document.querySelector('#camera') as HTMLVideoElement).currentTime});
    };requestAnimationFrame(sample);
  }));
  expect(observation.time).toBe(stoppedAt);
  expect(observation.labels).not.toContain('蓄力 · 展开释放');
  expect(observation.bursts).toEqual(['000']);
  await page.locator('#camera').evaluate(node=>(node as HTMLVideoElement).play());
  await expect(page.locator('#hand-count')).toHaveText('0 / 2');
  await observeStableBurst(page,'000');
  await expect(page.locator('#charge-label')).toHaveText('能量就绪');
  await page.setViewportSize({width:640,height:480});
  await expect(page.locator('#hand-count')).toHaveText('1 / 2',{timeout:15_000});
  await expect(page.locator('#charge-label')).toHaveText('蓄力 · 展开释放',{timeout:15_000});
  await page.getByRole('button',{name:'停止手势',exact:true}).click();
});

test('real camera fills the stage below transparent effects and stops cleanly', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtureCamera(page);
  await page.goto('/');
  expect((await cameraLifecycle(page)).requestCount).toBe(0);
  await page.getByRole('button', { name: '开启手势', exact: true }).click();
  await expect(page.locator('#tracking-badge')).toHaveText('LIVE', { timeout: 45_000 });
  await expect(page.locator('body')).toHaveClass(/camera-active/);
  await expect(page.locator('#hand-count')).toHaveText('2 / 2', { timeout: 15_000 });
  const initial = await cameraLifecycle(page);
  const layers = await page.evaluate(() => {
    const video = document.querySelector('#camera') as HTMLVideoElement;
    const canvas = document.querySelector('#lightning') as HTMLCanvasElement;
    const box = (node: Element) => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { video: box(video), effects: box(canvas), viewport: { x: 0, y: 0, w: innerWidth, h: innerHeight },
      fit: getComputedStyle(video).objectFit, mirror: getComputedStyle(video).transform,
      alpha: canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3] };
  });
  expect(layers.video).toEqual(layers.viewport);
  expect(layers.effects).toEqual(layers.viewport);
  expect(layers.fit).toBe('cover');
  expect(layers.mirror).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  expect(layers.alpha).toBeLessThan(100);
  await expect(page.locator('#hand-overlay')).not.toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '显示手部骨架', exact: true }).check();
  await expect(page.locator('#hand-overlay')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.screenshot({ path: 'docs/evidence/camera-chidori-desktop.png' });
  await page.getByRole('button', { name: '旋风手里剑', exact: true }).click();
  expect((await cameraLifecycle(page)).attachedStreamId).toBe(initial.attachedStreamId);
  expect((await cameraLifecycle(page)).requestCount).toBe(1);
  await page.screenshot({ path: 'docs/evidence/camera-shuriken-desktop.png' });
  await page.evaluate(() => window.__effectsCamera.switchTo('open'));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#hand-count')).toHaveText('1 / 2', { timeout: 15_000 });
  await expect(page.locator('#camera')).toHaveCSS('object-fit', 'cover');
  await page.screenshot({ path: 'docs/evidence/camera-shuriken-phone.png' });
  await page.getByRole('button', { name: '停止手势', exact: true }).click();
  await expect(page.locator('body')).not.toHaveClass(/camera-active/);
  await expect(page.locator('#camera')).not.toBeVisible();
  expect((await cameraLifecycle(page)).trackStates).toEqual([['ended']]);
  expect((await cameraLifecycle(page)).attachedStreamId).toBeNull();
  await expect.poll(() => page.locator('#lightning').evaluate(node =>
    (node as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3])).toBe(255);
  expect(errors).toEqual([]);
});
