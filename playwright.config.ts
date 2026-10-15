import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.BUGPROOF_PORT ?? process.env.PORT ?? 3100);
const BASE_URL = process.env.BUGPROOF_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  // Unit tests under tests/unit are node:test files, not Playwright specs.
  testMatch: '**/*.spec.ts',
  // Each phase arms defects process-wide, so tests must not overlap.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // No retries on purpose: a retry would paper over a flaky repro, and the whole
  // point of the red phase is to read the raw pass/fail signal.
  retries: 0,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  outputDir: process.env.BUGPROOF_OUTPUT_DIR ?? 'test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    // The CLI reads this file to judge the run. Given an explicit path rather
    // than left to default to stdout, so direct `playwright test` stays readable.
    ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? '.bugproof/tmp/report.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    // Traces and screenshots are the deliverable posted back to the ticket, not
    // just debugging aids, so they are captured on every run including passes.
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx tsx app/server.ts',
    url: `${BASE_URL}/healthz`,
    // Must not reuse: a server left over from a previous phase would have the
    // wrong defects armed and silently invalidate the verdict.
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    env: {
      PORT: String(PORT),
      BUGPROOF_BUGS: process.env.BUGPROOF_BUGS ?? '',
    },
  },
});
