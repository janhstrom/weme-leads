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
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
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
