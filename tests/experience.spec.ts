import { test, expect } from '@playwright/test';
import { closeSettings, openSettings } from './helpers/settings';

test('landing is a working visual experience and demo controls expand the field', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'千鸟'})).toBeVisible();
  await expect(page.locator('#lightning')).toBeVisible();
  await openSettings(page);
  await page.getByRole('button',{name:'鼠标体验',exact:true}).click();
  await expect(page.locator('#mode-label')).toHaveText('鼠标控制');
  await openSettings(page);
  const slider=page.getByRole('slider',{name:'雷电范围'});
  await slider.fill('100');
  await expect.poll(async()=>Number(await page.locator('#energy-value').textContent())).toBeGreaterThan(95);
  await slider.fill('0');
  await expect.poll(async()=>Number(await page.locator('#energy-value').textContent())).toBeLessThan(5);
  await closeSettings(page);
  await page.locator('#lightning').click({position:{x:600,y:320}});
  await page.keyboard.down('Space');
  await expect(page.locator('#state-label')).toHaveText('蓄力中');
  await page.keyboard.up('Space');
  await expect.poll(async()=>Number(await page.locator('#energy-value').textContent())).toBeGreaterThan(95);
  await page.getByRole('button',{name:'静音',exact:true}).click();
  await expect(page.getByRole('button',{name:'开启声音',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'使用说明'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('camera rejection provides a useful fallback', async ({page})=>{
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')};
  });
  await page.goto('/');
  await page.getByRole('button',{name:'开启手势',exact:true}).click();
  await expect(page.locator('#status-message')).toContainText(/权限|允许/, {timeout:25000});
  await openSettings(page);
  await page.getByRole('button',{name:'鼠标体验',exact:true}).click();
  await expect(page.locator('#mode-label')).toHaveText('鼠标控制');
});

test('keyboard-only launch focuses the field and supports space charging',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'设置',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'鼠标体验',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#lightning')).toBeFocused();
  await page.keyboard.down('Space');
  await expect(page.locator('#state-label')).toHaveText('蓄力中');
  await page.keyboard.up('Space');
  await expect(page.locator('#state-label')).toHaveText('全域释放');
});

test('range keyboard steps preserve requested value while animation is smoothing',async({page})=>{
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button',{name:'鼠标体验',exact:true}).click();
  await openSettings(page);
  const slider=page.getByRole('slider',{name:'雷电范围'});
  await slider.fill('30');await slider.focus();
  for(let i=0;i<10;i++)await page.keyboard.press('ArrowRight',{delay:100});
  await expect(slider).toHaveValue('40');
  await expect.poll(async()=>Number(await page.locator('#energy-value').textContent())).toBe(40);
});

test('mobile view fits without horizontal overflow and supports touch demo', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button',{name:'鼠标体验',exact:true}).click();
  await expect(page.locator('#mode-label')).toHaveText('鼠标控制');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'开启手势',exact:true})).toBeInViewport();
});

test('fullscreen covers the viewport and can be exited',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'进入全屏',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  const geometry=await page.locator('#lightning').evaluate(canvas=>{
    const rect=canvas.getBoundingClientRect();return {x:rect.x,y:rect.y,w:rect.width,h:rect.height,vw:innerWidth,vh:innerHeight};
  });
  expect(geometry).toMatchObject({x:0,y:0,w:geometry.vw,h:geometry.vh});
  await openSettings(page);
  await page.getByRole('button',{name:'鼠标体验',exact:true}).click();
  await openSettings(page);
  await page.getByRole('slider',{name:'雷电范围'}).fill('100');
  await expect.poll(async()=>Number(await page.locator('#energy-value').textContent())).toBe(100);
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
});
