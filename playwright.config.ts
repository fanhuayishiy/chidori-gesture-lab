import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', timeout: 30000, workers: 1,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:5173', viewport: {width:1440,height:960},
    launchOptions: { channel: 'msedge' },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: process.env.TEST_BASE_URL ? 'npm run preview -- --port 4173' : 'npm run dev', url: process.env.TEST_BASE_URL || 'http://127.0.0.1:5173', reuseExistingServer: true },
});
