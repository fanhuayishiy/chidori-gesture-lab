import { expect, test } from '@playwright/test';
import { openSettings } from './helpers/settings';

test('pointer ownership ignores a second finger release', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: '鼠标体验', exact: true }).click();
  const rect = (await page.locator('#lightning').boundingBox())!;
  const first = { x: rect.x + rect.width * .55, y: rect.y + 280, id: 1 };
  const second = { x: first.x + 50, y: first.y, id: 2 };
  const input = await page.context().newCDPSession(page);
  await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  await expect(page.locator('#state-label')).toHaveText('蓄力中');
  await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
  // CDP touchEnd lists the changed/released point, not the remaining touch.
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
  await expect(page.locator('#burst-count')).toHaveText('000');
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#burst-count')).toHaveText('001');
});

test('mixed input ownership keeps pointer and keyboard holds separate', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: '鼠标体验', exact: true }).click();
  const rect = (await page.locator('#lightning').boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .55, rect.y + 280);
  await page.mouse.down();
  await page.keyboard.press('Space');
  await expect(page.locator('#burst-count')).toHaveText('000');
  await page.mouse.up();
  await expect(page.locator('#burst-count')).toHaveText('001');
  await expect(page.getByRole('button', { name: '爆发', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '爆发', exact: true })).toBeEnabled();
  await page.locator('#lightning').focus();
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#burst-count')).toHaveText('001');
  await page.keyboard.up('Space');
  await expect(page.locator('#burst-count')).toHaveText('002');
});

test('wind mode has applicable mode-neutral help instructions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '旋风手里剑', exact: true }).click();
  await page.getByRole('button', { name: '使用说明', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('张开五指扩大当前效果');
  await expect(page.getByRole('dialog')).toContainText('核心跟随掌心');
  await expect(page.getByRole('dialog')).toContainText('能量核心');
  await expect(page.getByRole('dialog')).toContainText('爆发');
});

test('effect switch preserves sound controls and manual bursts share cooldown', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const chidori = page.getByRole('button', { name: '千鸟', exact: true });
  const wind = page.getByRole('button', { name: '旋风手里剑', exact: true });
  const burst = page.getByRole('button', { name: '爆发', exact: true });
  await expect(chidori).toHaveAttribute('aria-pressed', 'true');
  await openSettings(page);
  await page.getByRole('button', { name: '鼠标体验', exact: true }).click();
  await openSettings(page);
  await page.getByRole('slider', { name: '音量', exact: true }).fill('20');
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await wind.click();
  await expect(wind).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '旋风手里剑', exact: true })).toBeVisible();
  await expect(page.getByRole('slider', { name: '音量', exact: true })).toHaveValue('20');
  await expect(page.getByRole('button', { name: '开启声音', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await burst.click();
  await expect(page.locator('#burst-count')).toHaveText('001');
  await expect(burst).toBeDisabled();
  await chidori.click();
  await expect(burst).toBeDisabled();
  await expect(page.locator('#burst-count')).toHaveText('001');
  await expect(burst).toBeEnabled();
  await burst.click();
  await expect(page.locator('#burst-count')).toHaveText('002');
  expect(errors).toEqual([]);
});

test('manual burst starts demo but never requests a camera and slider does not burst', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new Error('Camera must not be requested'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '爆发', exact: true }).click();
  await expect(page.locator('#mode-label')).toHaveText('鼠标控制');
  await expect(page.locator('#tracking-badge')).toHaveText('STANDBY');
  await expect(page.locator('#burst-count')).toHaveText('001');
  await expect(page.getByRole('button', { name: '爆发', exact: true })).toBeEnabled();
  await openSettings(page);
  await page.getByRole('slider', { name: '雷电范围', exact: true }).fill('100');
  await page.getByRole('slider', { name: '雷电范围', exact: true }).fill('0');
  await expect(page.locator('#burst-count')).toHaveText('001');
});

test('keyboard release bursts once while blur and effect switches cancel pending charge', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: '鼠标体验', exact: true }).click();
  await page.keyboard.down('Space');
  await expect(page.locator('#state-label')).toHaveText('蓄力中');
  await page.keyboard.up('Space');
  await expect(page.locator('#burst-count')).toHaveText('001');
  await expect(page.getByRole('button', { name: '爆发', exact: true })).toBeEnabled();
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Space');
  await expect(page.locator('#burst-count')).toHaveText('001');
  await page.locator('#lightning').focus();
  await page.keyboard.down('Space');
  await page.getByRole('button', { name: '旋风手里剑', exact: true }).click();
  await page.keyboard.up('Space');
  await expect(page.locator('#burst-count')).toHaveText('001');
});

test('wind mode fits a phone and supports reduced motion and full-screen controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '旋风手里剑', exact: true }).click();
  await openSettings(page);
  await page.getByRole('checkbox', { name: '柔和模式', exact: true }).check();
  await expect(page.getByRole('button', { name: '爆发', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '进入全屏', exact: true }).click();
  await page.getByRole('button', { name: '爆发', exact: true }).click();
  await expect(page.locator('#burst-count')).toHaveText('001');
  await expect(page.getByRole('button', { name: '退出全屏', exact: true })).toBeVisible();
});
