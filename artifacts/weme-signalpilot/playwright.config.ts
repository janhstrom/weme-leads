import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/pages",
  testMatch: "dashboard.browser.test.ts",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm run dev",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BASE_PATH: "/",
      PORT: "4173",
    },
  },
});