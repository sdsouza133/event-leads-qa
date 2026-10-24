import { readFile } from "node:fs/promises";

import { type APIRequestContext, expect, test } from "@playwright/test";

// A real browser through a whole run, as a requester sees it: the start form, the sign-in link from the email, the
// plan, approval, and the list with its CSV.
//
// It reads the sign-in email from the site's outbox, so it only runs where emails are kept instead of sent and
// QA_TOKEN opens the outbox: previews, staging and the local compose stack (fake providers). Each run uses up one
// of the company's free runs, so those environments set FREE_RUNS_PER_DOMAIN high.
//
// The requester's company is example.org, a reserved domain: the fake providers' people work at example.com
// addresses, and the app leaves out anyone at the requester's own company.

const QA_TOKEN = process.env.QA_TOKEN ?? "";
const DOMAIN = process.env.QA_DOMAIN ?? "example.org";
const CSV_HEADER = "Name,Title,Company,Email,LinkedIn,Event,Attendance,Post,ICP score,Why they fit";

/** Whether this site keeps emails in an outbox our token opens. Production has none, so the test never runs there. */
async function outboxOpens(request: APIRequestContext): Promise<boolean> {
  const response = await request.get(`/dev/outbox/latest?to=${encodeURIComponent(`nobody@${DOMAIN}`)}`, {
    headers: { "X-QA-Token": QA_TOKEN },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return response.status() === 404 && body.error === "no email to that address";
}

async function signInLink(request: APIRequestContext, to: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(`/dev/outbox/latest?to=${encodeURIComponent(to)}`, {
          headers: { "X-QA-Token": QA_TOKEN },
        });
        if (response.status() !== 200) {
          return "";
        }
        const email = (await response.json()) as { text: string };
        link = /\/sign-in\?token=[A-Za-z0-9_-]+/.exec(email.text)?.[0] ?? "";
        return link;
      },
      { message: "the sign-in email never arrived", timeout: 30_000 },
    )
    .not.toBe("");
  return link;
}

test.describe("a whole run", () => {
  test.skip(!QA_TOKEN, "needs QA_TOKEN: the sign-in link is read from the site's outbox");

  test("goes from the start form to a list to download", async ({ page, request }) => {
    const email = `qa-${Date.now().toString(36)}@${DOMAIN}`;

    await test.step("check the site keeps its emails", async () => {
      // Before anything is created: QA_TOKEN set for a site that sends real email (production) is a mistake.
      expect(await outboxOpens(request), "QA_TOKEN doesn't open this site's outbox: wrong token, or production?").toBe(
        true,
      );
    });

    await test.step("ask for a sign-in link", async () => {
      await page.goto("/");
      await page.getByLabel("Your company's website").fill(`https://${DOMAIN}/`);
      await page.getByLabel("Your work email").fill(email);
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    });

    await test.step("sign in with the emailed link", async () => {
      await page.goto(await signInLink(request, email));
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await page.getByRole("button", { name: "Sign in and continue" }).click();
    });

    await test.step("approve the plan", async () => {
      // The run page checks back every few seconds and reloads when the run moves on: first to its plan.
      await expect(page.getByRole("heading", { name: `Your plan for ${DOMAIN}` })).toBeVisible({ timeout: 90_000 });
      await page.getByRole("checkbox", { name: /Search this event/ }).first().check();
      await page.getByRole("button", { name: "Approve and start" }).click();
    });

    await test.step("see the list", async () => {
      await expect(page.getByRole("heading", { name: `Your leads for ${DOMAIN}` })).toBeVisible({ timeout: 150_000 });
      const table = page.getByRole("table", { name: "Your leads, best fit first" });
      await expect(table).toBeVisible();
      await expect(table.getByRole("row")).not.toHaveCount(1); // more than the header row
    });

    await test.step("download it as a CSV", async () => {
      const downloading = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download the list (CSV)" }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/\.csv$/);
      const csv = await readFile(await download.path(), "utf8");
      expect(csv.startsWith(`﻿${CSV_HEADER}`)).toBe(true);
      expect(csv.trim().split(/\r?\n/).length).toBeGreaterThan(1);
    });
  });
});
