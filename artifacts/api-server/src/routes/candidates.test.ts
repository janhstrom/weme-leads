import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { db, leadCandidateEvidenceTable, leadCandidatesTable, leadCandidateSnapshotsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app";

const testRun = `monitoring-history-${Date.now()}`;
const companyNames = {
  monitored: `Historikk overvåket ${testRun}`,
  mainList: `Historikk hovedliste ${testRun}`,
  review: `Historikk vurdering ${testRun}`,
};

let server: Server;
let baseUrl: string;
let monitoredCandidateId: number;
let mainListCandidateId: number;
let reviewCandidateId: number;

async function request(path: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return { response, body: await response.json() };
}

before(async () => {
  const candidates = await db
    .insert(leadCandidatesTable)
    .values([
      {
        companyName: companyNames.monitored,
        normalizedName: companyNames.monitored.toLowerCase(),
        matchStatus: "exact",
        relevanceStatus: "relevant",
        relevanceReason: "Testkandidat med kildehistorikk",
        relevanceSource: "system",
        monitoringStatus: "not_monitoring",
        priorityScore: 30,
        priorityReasons: ["Testgrunnlag"],
      },
      {
        companyName: companyNames.mainList,
        normalizedName: companyNames.mainList.toLowerCase(),
        matchStatus: "exact",
        relevanceStatus: "relevant",
        relevanceReason: "Testkandidat uten overvåkning",
        relevanceSource: "system",
        monitoringStatus: "not_monitoring",
        priorityScore: 20,
        priorityReasons: ["Testgrunnlag"],
      },
      {
        companyName: companyNames.review,
        normalizedName: companyNames.review.toLowerCase(),
        matchStatus: "needs_review",
        relevanceStatus: "needs_review",
        relevanceReason: "Testkandidat som trenger vurdering",
        relevanceSource: "system",
        monitoringStatus: "not_monitoring",
        priorityScore: 0,
        priorityReasons: ["Testgrunnlag"],
      },
    ])
    .returning({ id: leadCandidatesTable.id });

  monitoredCandidateId = candidates[0]!.id;
  mainListCandidateId = candidates[1]!.id;
  reviewCandidateId = candidates[2]!.id;

  await db.insert(leadCandidateSnapshotsTable).values([
    {
      candidateId: monitoredCandidateId,
      sourceType: "dnb_bisnode",
      sourceRowId: `${testRun}-dnb`,
      snapshotDate: "2026-08-01",
      originalCompanyName: companyNames.monitored,
      data: { employees: 240, fields: { Kilde: "D&B test" } },
    },
    {
      candidateId: monitoredCandidateId,
      sourceType: "sales_navigator",
      sourceRowId: `${testRun}-sales`,
      snapshotDate: "2026-08-15",
      originalCompanyName: companyNames.monitored,
      data: {
        employees: 260,
        personName: "Testperson",
        roleTitle: "Head of Digital Transformation",
        fields: { Kilde: "Sales Navigator test" },
      },
    },
    {
      candidateId: mainListCandidateId,
      sourceType: "dnb_bisnode",
      sourceRowId: `${testRun}-main`,
      snapshotDate: "2026-08-10",
      originalCompanyName: companyNames.mainList,
      data: { employees: 100, fields: { Kilde: "D&B test" } },
    },
    {
      candidateId: reviewCandidateId,
      sourceType: "manual",
      sourceRowId: `${testRun}-review`,
      snapshotDate: "2026-08-12",
      originalCompanyName: companyNames.review,
      data: { employees: null, fields: { Kilde: "Manuell test" } },
    },
  ]);
  await db.insert(leadCandidateEvidenceTable).values({
    candidateId: monitoredCandidateId,
    title: "Offentlig dokumentasjon for historikktest",
    url: `https://example.com/${testRun}`,
    sourceType: "Selskapsnyhet",
    publishedAt: "2026-08-15",
    excerpt: "Dette er offentlig dokumentasjon som skal bevares gjennom statusendringer.",
    verificationStatus: "url_verified",
  });

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  const candidates = await db
    .select({ id: leadCandidatesTable.id })
    .from(leadCandidatesTable)
    .where(inArray(leadCandidatesTable.companyName, Object.values(companyNames)));
  const ids = candidates.map((candidate) => candidate.id);
  if (ids.length > 0) {
    await db.delete(leadCandidateEvidenceTable).where(inArray(leadCandidateEvidenceTable.candidateId, ids));
    await db.delete(leadCandidateSnapshotsTable).where(inArray(leadCandidateSnapshotsTable.candidateId, ids));
    await db.delete(leadCandidatesTable).where(inArray(leadCandidatesTable.id, ids));
  }
});

async function withEvidenceFetch<T>(
  sourceUrl: string,
  handler: (method: string, signal?: AbortSignal) => Response | Promise<Response>,
  action: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === sourceUrl) {
      return Promise.resolve(handler(init?.method ?? "GET", init?.signal ?? undefined));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("bevarer kandidatens kildehistorikk når overvåkning legges til og fjernes", async () => {
  const add = await request(`/candidates/${monitoredCandidateId}/monitoring`, {
    method: "PATCH",
    body: JSON.stringify({ monitoringStatus: "monitoring", reason: "Følg ferske signaler" }),
  });
  assert.equal(add.response.status, 200);
  assert.equal(add.body.monitoringStatus, "monitoring");
  assert.equal(add.body.snapshots.length, 2);
  assert.equal(add.body.evidence.length, 1);
  assert.equal(add.body.changes.length > 0, true);

  const monitoringList = await request("/candidates?view=monitoring");
  assert.equal(monitoringList.response.status, 200);
  const monitoringIds = monitoringList.body.map((candidate: { id: number }) => candidate.id);
  assert.ok(monitoringIds.includes(monitoredCandidateId));
  assert.ok(!monitoringIds.includes(mainListCandidateId));
  assert.ok(!monitoringIds.includes(reviewCandidateId));
  const monitoredFromList = monitoringList.body.find(
    (candidate: { id: number }) => candidate.id === monitoredCandidateId,
  );
  assert.equal(monitoredFromList.snapshots.length, 2);
  assert.equal(monitoredFromList.evidence.length, 1);

  const remove = await request(`/candidates/${monitoredCandidateId}/monitoring`, {
    method: "PATCH",
    body: JSON.stringify({ monitoringStatus: "not_monitoring", reason: "Ikke aktuell akkurat nå" }),
  });
  assert.equal(remove.response.status, 200);
  assert.equal(remove.body.monitoringStatus, "not_monitoring");
  assert.equal(remove.body.snapshots.length, 2);
  assert.equal(remove.body.evidence.length, 1);
  assert.equal(remove.body.changes.length > 0, true);

  const mainList = await request("/candidates");
  assert.equal(mainList.response.status, 200);
  const mainListIds = mainList.body.map((candidate: { id: number }) => candidate.id);
  assert.ok(mainListIds.includes(monitoredCandidateId));
  assert.ok(mainListIds.includes(mainListCandidateId));
  assert.ok(mainListIds.includes(reviewCandidateId));
  const retained = mainList.body.find((candidate: { id: number }) => candidate.id === monitoredCandidateId);
  assert.equal(retained.monitoringStatus, "not_monitoring");
  assert.equal(retained.snapshots.length, 2);
  assert.equal(retained.evidence.length, 1);

  const reviewList = await request("/candidates?view=review");
  assert.equal(reviewList.response.status, 200);
  const reviewIds = reviewList.body.map((candidate: { id: number }) => candidate.id);
  assert.ok(reviewIds.includes(reviewCandidateId));
  assert.ok(!reviewIds.includes(monitoredCandidateId));
  assert.ok(!reviewIds.includes(mainListCandidateId));
});

test("avviser identisk evidens-URL og beholder eksisterende evidens", async () => {
  const evidenceUrl = `https://example.com/${testRun}`;
  const duplicate = await request(`/candidates/${monitoredCandidateId}/evidence`, {
    method: "POST",
    body: JSON.stringify({
      title: "Ny tittel for samme offentlige kilde",
      url: evidenceUrl,
      sourceType: "Selskapsnyhet",
      publishedAt: "2026-08-16",
      excerpt: "Et nytt sitat skal ikke opprette en ny post for samme dokumentasjon.",
    }),
  });

  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error, "Denne evidens-URL-en finnes allerede for kandidaten.");

  const candidate = await request(`/candidates/${monitoredCandidateId}`);
  assert.equal(candidate.response.status, 200);
  assert.equal(candidate.body.evidence.length, 1);
  assert.equal(candidate.body.evidence[0].url, evidenceUrl);
  assert.equal(candidate.body.evidence[0].title, "Offentlig dokumentasjon for historikktest");
  assert.equal(candidate.body.lastAnalyzedAt !== null, true);
  assert.ok(candidate.body.priorityReasons.includes("Offentlig dokumentasjon: 1 verifisert kilde"));
});

test("lagrer gyldig offentlig kandidatkilde med 201", async () => {
  const evidenceUrl = "https://vippsmobilepay.test/vipps-mobilepay";
  const result = await withEvidenceFetch(
    evidenceUrl,
    () => new Response("<html>Vipps MobilePay</html>", { status: 200 }),
    () => request(`/candidates/${mainListCandidateId}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        title: "Vipps MobilePay lanserer ny løsning",
        url: `  ${evidenceUrl}  `,
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-08-20",
      }),
    }),
  );

  assert.equal(result.response.status, 201);
  assert.equal(result.body.evidence.length, 1);
  assert.equal(result.body.evidence[0].url, evidenceUrl);
  assert.equal(result.body.evidence[0].title, "Vipps MobilePay lanserer ny løsning");
  assert.equal(result.body.evidence[0].excerpt, "");
  assert.equal(result.body.relevanceStatus, "relevant");
  assert.equal(result.body.relevanceConfidence, "high");
  assert.equal(result.body.lastAnalyzedAt !== null, true);
  assert.ok(result.body.priorityReasons.includes("Offentlig dokumentasjon: 1 verifisert kilde"));
});

test("bruker GET når kildeserveren avviser HEAD", async () => {
  const methods: string[] = [];
  const evidenceUrl = "https://vippsmobilepay.test/head-fallback";
  const result = await withEvidenceFetch(
    evidenceUrl,
    (method) => {
      methods.push(method);
      return new Response(method === "HEAD" ? null : "<html>GET-fallback</html>", { status: method === "HEAD" ? 405 : 200 });
    },
    () => request(`/candidates/${reviewCandidateId}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        title: "Kilde som bare støtter GET",
        url: evidenceUrl,
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-08-21",
        excerpt: "Denne offentlige kilden svarer på GET når HEAD ikke er støttet.",
      }),
    }),
  );

  assert.equal(result.response.status, 201);
  assert.deepEqual(methods, ["HEAD", "GET"]);
  assert.equal(result.body.evidence[0].url, evidenceUrl);
});

test("viser konkret valideringsfeil og lagrer ikke ugyldig evidens", async () => {
  const result = await request(`/candidates/${reviewCandidateId}/evidence`, {
    method: "POST",
    body: JSON.stringify({
      title: "Kort",
      url: "https://example.com/validation",
      sourceType: "Selskapsnyhet",
      publishedAt: "2026-08-22",
      excerpt: "For kort",
    }),
  });

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "Kildetittel må være minst 5 tegn.");
  const candidate = await request(`/candidates/${reviewCandidateId}`);
  assert.equal(candidate.body.evidence.length, 1);
});

test("viser HTTP-feil fra kilden uten å lagre evidens", async () => {
  const evidenceUrl = "https://vippsmobilepay.test/unavailable";
  const result = await withEvidenceFetch(
    evidenceUrl,
    () => new Response(null, { status: 503 }),
    () => request(`/candidates/${reviewCandidateId}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        title: "Utilgjengelig offentlig kilde",
        url: evidenceUrl,
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-08-23",
        excerpt: "Kilden svarer med en kontrollert HTTP-feil og skal ikke lagres.",
      }),
    }),
  );

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "Kilden kunne ikke kontrolleres (HTTP 503).");
  const candidate = await request(`/candidates/${reviewCandidateId}`);
  assert.equal(candidate.body.evidence.length, 1);
});

test("avbryter kontrollert ved timeout uten å lagre evidens", async () => {
  const evidenceUrl = "https://vippsmobilepay.test/timeout";
  const result = await withEvidenceFetch(
    evidenceUrl,
    (_method, signal) => new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
    () => request(`/candidates/${reviewCandidateId}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        title: "Kilde som aldri svarer",
        url: evidenceUrl,
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-08-24",
        excerpt: "Denne testen holder forbindelsen åpen for å utløse tidsgrensen.",
      }),
    }),
  );

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "Kildekontrollen tok mer enn seks sekunder.");
  const candidate = await request(`/candidates/${reviewCandidateId}`);
  assert.equal(candidate.body.evidence.length, 1);
});
