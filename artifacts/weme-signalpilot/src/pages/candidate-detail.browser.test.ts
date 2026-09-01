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
  await page.route("**/api/candidates/1/sources", async (route) => {
    await route.fulfill({ json: [] });
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
    if (body.url === "https://vippsmobilepay.com/news") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ...candidate,
          evidence: [
            ...candidate.evidence,
            {
              title: body.title,
              url: body.url,
              sourceType: body.sourceType,
              publishedAt: body.publishedAt,
              excerpt: body.excerpt,
              verificationStatus: "url_verified",
              verifiedAt: "2026-08-22T12:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: body.url === "not-a-url"
          ? "Kilden må være en gyldig URL."
          : "Tittel, HTTPS-URL, publiseringsdato, kildetype og sitat er påkrevd.",
      }),
    });
  });

  await page.goto("/candidates/1");

  await page.getByPlaceholder("Kildetittel").fill("Ny tittel for samme kilde");
  await page.getByRole("textbox", { name: "HTTPS-URL" }).fill(evidenceUrl);
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
  await expect(page.getByRole("textbox", { name: "HTTPS-URL" })).toHaveValue(evidenceUrl);
  await expect(
    page.getByPlaceholder("Kort, relevant sitat fra kilden"),
  ).toHaveValue("Et nytt sitat som skal beholdes etter duplikatmeldingen.");

  await page.getByRole("textbox", { name: "HTTPS-URL" }).fill("not-a-url");
  await page.getByRole("button", { name: "Kontroller og legg til kilde" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Kilden må være en gyldig URL." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "HTTPS-URL" })).toHaveValue("not-a-url");
  await expect(page.locator('div[role="alert"]').filter({ hasText: "Denne kilden er allerede registrert" })).toHaveCount(0);

  await page.getByPlaceholder("Kildetittel").fill("Vipps MobilePay lanserer ny løsning");
  await page.getByRole("textbox", { name: "HTTPS-URL" }).fill("https://vippsmobilepay.com/news");
  await page.getByPlaceholder("Kort, relevant sitat fra kilden").fill("Vipps MobilePay beskriver en ny offentlig løsning for kundene sine.");
  await page.getByRole("button", { name: "Kontroller og legg til kilde" }).click();
  await expect(page.getByText("Kilde kontrollert", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Kildetittel")).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "HTTPS-URL" })).toHaveValue("");
});