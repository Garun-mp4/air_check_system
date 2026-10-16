import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  testMatch: process.env.E2E_SYSTEM_MODE === 'real' ? 'real-system.spec.ts' : 'system.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  outputDir: '../tests/browser/artifacts/results',
  reporter: [
    ['list'],
    [
      'html',
      { outputFolder: '../tests/browser/artifacts/report', open: 'never' },
    ],
  ],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    },
  },
})
