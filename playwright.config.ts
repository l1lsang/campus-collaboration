import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 65_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL, trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: baseURL },
})
