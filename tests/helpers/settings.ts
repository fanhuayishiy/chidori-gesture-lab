import type { Page } from '@playwright/test';

export async function openSettings(page: Page) {
  if (await page.locator('#settings-panel').isHidden()) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
  }
}

export async function closeSettings(page: Page) {
  if (await page.locator('#settings-panel').isVisible()) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
  }
}
