import { expect, test } from "@playwright/test";

const knownRun = {
  id: 42,
  status: "completed",
  trigger: "scheduled",
  kind: "monitoring",
  requestedCount: 7,
  processedCount: 7,
  signalsCreated: 4,
  crmMatchedCount: 3,
  crmUnresolvedCount: 2,
  sourceErrorCount: 1,
  errorSummary: null,
  startedAt: "2026-08-22T09:55:00.000Z",
  completedAt: "2026-08-22T10:00:00.000Z",
};

const knownActions = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1,
  company: {
    name: `Eksempel AS ${index + 1}`,
    employees: 12,
    industry: "Teknologi",
    domain: "example.com",
  },
  signalType: "Ny offentlig endring",
  strength: "A",
  status: "til_vurdering",
  summary: "En kjent offentlig endring fra overvåkningskilden.",
  evidence: [],
  contacts: [],
  crm: {
    status: "unresolved",
    matchCount: 0,
  },
}));

const refreshedRun = {
  ...knownRun,
  id: 43,
  requestedCount: 2,
  processedCount: 2,
  signalsCreated: 6,
  crmMatchedCount: 1,
  crmUnresolvedCount: 1,
  sourceErrorCount: 0,
  startedAt: "2026-08-23T09:55:00.000Z",
  completedAt: "2026-08-23T10:00:00.000Z",
};

const refreshedActions = knownActions.slice(0, 2).map((action, index) => ({
  ...action,
  id: index + 101,
  summary: "Et nytt offentlig funn fra den oppdaterte overvåkningskjøringen.",
}));

test("keeps the known queue visible after a failed monitoring run", async ({
  page,
}) => {
  await page.route("**/api/monitoring/runs/latest", async (route) => {
    await route.fulfill({ json: knownRun });
  });
  await page.route("**/api/monitoring/actions", async (route) => {
    await route.fulfill({ json: knownActions });
  });
  await page.route("**/api/monitoring/runs", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Kildekontrollen feilet." }),
    });
  });

  await page.goto("/");

  await expect(page.getByText("Følg opp nå", { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownActions.length), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.signalsCreated), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.crmUnresolvedCount), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.sourceErrorCount), { exact: true })).toBeVisible();
  await expect(page.getByText("Siste kjøring: fullført · 7/7 kandidater · 4 nye signaler · 1 kildeavvik", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Kjør overvåkning nå" }).click();

  await expect(page.getByRole("alert")).toContainText("Kjøringen kunne ikke startes.");
  await expect(page.getByRole("alert")).toContainText("Kildekontrollen feilet.");
  await expect(page.getByText(String(knownActions.length), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.signalsCreated), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.crmUnresolvedCount), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.sourceErrorCount), { exact: true })).toBeVisible();
  await expect(page.getByText("Siste kjøring: fullført · 7/7 kandidater · 4 nye signaler · 1 kildeavvik", { exact: true })).toBeVisible();
});

test("shows refreshed monitoring totals after a successful run", async ({ page }) => {
  let latestRun = knownRun;
  let actions = knownActions;
  let startRunCalls = 0;
  let latestRunCalls = 0;
  let actionsCalls = 0;

  await page.route("**/api/monitoring/runs/latest", async (route) => {
    latestRunCalls += 1;
    await route.fulfill({ json: latestRun });
  });
  await page.route("**/api/monitoring/actions", async (route) => {
    actionsCalls += 1;
    await route.fulfill({ json: actions });
  });
  await page.route("**/api/monitoring/runs", async (route) => {
    expect(route.request().method()).toBe("POST");
    startRunCalls += 1;
    latestRun = refreshedRun;
    actions = refreshedActions;
    await route.fulfill({ json: refreshedRun });
  });

  await page.goto("/");

  await expect(page.getByText(String(knownActions.length), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.signalsCreated), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.crmUnresolvedCount), { exact: true })).toBeVisible();
  await expect(page.getByText(String(knownRun.sourceErrorCount), { exact: true })).toBeVisible();
  await expect(page.getByText("Siste kjøring: fullført · 7/7 kandidater · 4 nye signaler · 1 kildeavvik", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Kjør overvåkning nå" }).click();

  await expect.poll(() => startRunCalls).toBe(1);
  await expect.poll(() => latestRunCalls).toBeGreaterThan(1);
  await expect.poll(() => actionsCalls).toBeGreaterThan(1);
  await expect(page.getByText(String(refreshedActions.length), { exact: true })).toBeVisible();
  await expect(page.getByText(String(refreshedRun.signalsCreated), { exact: true })).toBeVisible();
  await expect(page.getByText(String(refreshedRun.crmUnresolvedCount), { exact: true })).toBeVisible();
  await expect(page.getByText(String(refreshedRun.sourceErrorCount), { exact: true })).toBeVisible();
  await expect(page.getByText("Siste kjøring: fullført · 2/2 kandidater · 6 nye signaler · 0 kildeavvik", { exact: true })).toBeVisible();
  await expect(page.getByText("Siste kjøring: fullført · 7/7 kandidater · 4 nye signaler · 1 kildeavvik", { exact: true })).toHaveCount(0);
});
