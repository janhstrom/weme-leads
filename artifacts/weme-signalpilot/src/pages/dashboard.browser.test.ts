import { expect, test } from "@playwright/test";

const knownSummary = {
  total: 7,
  pending: 7,
  approved: 4,
  highPriority: 2,
  crmTasks: 3,
  pilotSourcesLastRefreshedAt: "2026-08-22T10:00:00.000Z",
  rejectedPilotSources: [],
};

test("keeps the known summary visible after a failed refresh", async ({
  page,
}) => {
  await page.route("**/api/dashboard/summary", async (route) => {
    await route.fulfill({ json: knownSummary });
  });
  await page.route("**/api/signals**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/dashboard/refresh", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Kildekontrollen feilet." }),
    });
  });

  await page.goto("/");

  await expect(page.getByText("Til vurdering", { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownSummary.pending), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownSummary.approved), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownSummary.highPriority), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownSummary.crmTasks), { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Oppfrisk pilotkilder" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Oppfriskningen mislyktes. Forrige kjente resultat vises fortsatt.",
  );
  await expect(page.getByText(String(knownSummary.pending), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownSummary.approved), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownSummary.highPriority), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownSummary.crmTasks), { exact: true })).toBeVisible();
});