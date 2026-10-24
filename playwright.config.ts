import { defineConfig, devices } from "@playwright/test";

// The site under test. Locally and in CI it's the app started by compose.yaml; QA_BASE_URL points it at a
// deployed preview, staging or production instead.
const baseURL = process.env.QA_BASE_URL ?? "http://localhost:8000";

// QA_TOKEN opens a site's outbox. Only the local stack's token is throwaway; anywhere else it's a real secret, so it
// only travels over HTTPS, and no trace keeps it: traces record request headers, and CI uploads them when a test fails.
const local = ["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname);
if (process.env.QA_TOKEN && !local && new URL(baseURL).protocol !== "https:") {
  throw new Error(`QA_TOKEN is only sent over HTTPS, and ${baseURL} isn't`);
}

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a test that passes on its second try is a bug to find, not a result to report.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: local ? "retain-on-failure" : "off" },
  projects: [
    // Plain HTTP checks, safe on every environment, production included.
    { name: "smoke", testMatch: /smoke\.spec\.ts$/ },
    // A real browser through a whole run. It needs an environment that keeps emails (QA_TOKEN set): a preview,
    // staging or the local compose stack, never production.
    {
      name: "e2e",
      testMatch: /e2e\.spec\.ts$/,
      timeout: 240_000,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
