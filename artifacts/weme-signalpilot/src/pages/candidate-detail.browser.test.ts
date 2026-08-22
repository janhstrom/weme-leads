import { expect, test } from "@playwright/test";

const evidenceUrl = "https://example.com/known-source";

const candidate = {
  id: 1,
  companyName: "Eksempel AS",
  organizationNumber: null,
  domain: "example.com",
  industry: "Teknologi",
  employees: 12,
  matchStatus: "exact",
  relevanceStatus: "needs_review",
  relevanceReason: null,
  relevanceSource: "system",
  monitoringStatus: "not_monitoring",
  monitoringReason: null,
  priorityScore: 8,
  priorityReasons: ["Ny offentlig endring"],
  lastAnalyzedAt: null,
  snapshots: [],
  changes: [],
  evidence: [
    {
      title: "Eksisterende offentlig dokumentasjon",
      url: evidenceUrl,
      sourceType: "Selskapsnyhet",
      publishedAt: "2026-08-16",
      excerpt: "Dette er et eksisterende sitat fra den offentlige kilden.",
    },
  ],
  createdAt: "2026-08-16T10:00:00.000Z",
  updatedAt: "2026-08-16T10:00:00.000Z",
};

test("forklarer duplikatkilde med lenke og beholder utfylt skjema", async ({
  page,
}) => {
  await page.route("**/api/candidates/1", async (route) => {
    await route.fulfill({ json: candidate });
  });
  await page.route("**/api/candidates", async (route) => {
    await route.fulfill({ json: [candidate] });
  });
  await page.route("**/api/candidates/1/evidence", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (body.url === evidenceUrl) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Denne evidens-URL-en finnes allerede for kandidaten.",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Tittel, HTTPS-URL, publiseringsdato, kildetype og sitat er påkrevd.",
      }),
    });
  });

  await page.goto("/candidates/1");

  await page.getByPlaceholder("Kildetittel").fill("Ny tittel for samme kilde");
  await page.getByPlaceholder("https://…").fill(evidenceUrl);
  await page.getByPlaceholder("Kildetype").fill("Selskapsnyhet");
  await page.locator('input[type="date"]').fill("2026-08-22");
  await page
    .getByPlaceholder("Kort, relevant sitat fra kilden")
    .fill("Et nytt sitat som skal beholdes etter duplikatmeldingen.");
  await page.getByRole("button", { name: "Kontroller og legg til kilde" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Denne kilden er allerede registrert");
  await expect(alert.getByRole("link", { name: /Åpne eksisterende kilde/ })).toHaveAttribute(
    "href",
    evidenceUrl,
  );
  await expect(page.getByPlaceholder("Kildetittel")).toHaveValue(
    "Ny tittel for samme kilde",
  );
  await expect(page.getByPlaceholder("https://…")).toHaveValue(evidenceUrl);
  await expect(
    page.getByPlaceholder("Kort, relevant sitat fra kilden"),
  ).toHaveValue("Et nytt sitat som skal beholdes etter duplikatmeldingen.");

  await page.getByPlaceholder("https://…").fill("not-a-url");
  await page.getByRole("button", { name: "Kontroller og legg til kilde" }).click();
  await expect(page.getByText("Kilden kunne ikke lagres", { exact: true })).toBeVisible();
  await expect(page.locator('div[role="alert"]').filter({ hasText: "Denne kilden er allerede registrert" })).toHaveCount(0);
});