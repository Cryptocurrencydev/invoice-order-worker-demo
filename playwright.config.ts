import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3200";
const local = !process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "mobile-390", use: { ...devices["Pixel 7"], browserName: "chromium", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 860 } } },
  ],
  webServer: local
    ? {
        command: "npx next start -p 3200",
        url: "http://localhost:3200",
        reuseExistingServer: false,
        env: { DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://localhost/iow_e2e", WORKER_MODEL: "mock" },
      }
    : undefined,
});
