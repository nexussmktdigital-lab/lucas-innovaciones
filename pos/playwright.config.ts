import { defineConfig, devices } from '@playwright/test';

/**
 * Tests de punta a punta.
 *
 * Requieren una base con las migraciones aplicadas y los datos de prueba:
 *   npm run db:migrate && npm run db:seed -- --reset
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://127.0.0.1:3131',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH
          ? { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` }
          : {},
      },
    },
  ],
  webServer: process.env.E2E_URL
    ? undefined
    : {
        command: 'npx next start -p 3131',
        url: 'http://127.0.0.1:3131/ingresar',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
