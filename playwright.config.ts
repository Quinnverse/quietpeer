import { defineConfig } from '@playwright/test';
const port = process.env.TEST_PORT || '5187';
const attempt = process.env.TEST_ATTEMPT || 'latest';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 },
  outputDir: `../.work/results/e2e-${attempt}`,
  reporter: [['list'], ['json', { outputFile: `../.work/results/e2e-${attempt}.json` }]],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1040 }, actionTimeout: 15000, screenshot: 'only-on-failure', trace: 'off' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: `PORT=${port} E2E_TEST=1 npm run dev`, url: `http://127.0.0.1:${port}/health`, reuseExistingServer: false, timeout: 30000 },
});
