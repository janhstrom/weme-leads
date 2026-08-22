import assert from "node:assert/strict";
import test from "node:test";
import {
  isDuplicateSnapshot,
  matchImportedCompany,
  normalizeCandidateDomain,
  normalizeCandidateName,
} from "./candidate-matching.ts";

const candidates = [
  { id: 1, organizationNumber: "NO123", domain: "alpha.no", normalizedName: normalizeCandidateName("Alpha AS") },
  { id: 2, organizationNumber: "NO456", domain: "beta.no", normalizedName: normalizeCandidateName("Beta AS") },
];

test("normalizes Nordic company names and domains consistently", () => {
  assert.equal(normalizeCandidateName("  Ålesund Teknologi AS  "), "alesund teknologi as");
  assert.equal(normalizeCandidateDomain("https://WWW.Alpha.no/company"), "alpha.no");
});

test("prefers exact organization number over domain and name", () => {
  const result = matchImportedCompany(
    { companyName: "Wrong display name", organizationNumber: "NO123", domain: "beta.no" },
    candidates,
  );
  assert.equal(result.status, "exact");
  assert.equal(result.candidate?.id, 1);
});

test("falls back to a unique domain match, then a unique name match", () => {
  const domainMatch = matchImportedCompany({ companyName: "Unknown", domain: "https://www.beta.no" }, candidates);
  assert.equal(domainMatch.status, "domain_match");
  assert.equal(domainMatch.candidate?.id, 2);

  const nameMatch = matchImportedCompany({ companyName: "Ålpha AS" }, candidates);
  assert.equal(nameMatch.status, "name_match");
  assert.equal(nameMatch.candidate?.id, 1);
});

test("does not merge ambiguous matches", () => {
  const result = matchImportedCompany(
    { companyName: "Shared AS" },
    [
      { id: 1, organizationNumber: null, domain: "one.no", normalizedName: normalizeCandidateName("Shared AS") },
      { id: 2, organizationNumber: null, domain: "two.no", normalizedName: normalizeCandidateName("Shared AS") },
    ],
  );
  assert.equal(result.status, "needs_review");
  assert.equal(result.candidate, undefined);
});

test("identifies duplicate source rows only within the same snapshot", () => {
  const snapshots = [{ sourceType: "dnb_bisnode", snapshotDate: "2026-08-22", sourceRowId: "7" }];
  assert.equal(isDuplicateSnapshot(snapshots, { sourceType: "dnb_bisnode", snapshotDate: "2026-08-22", sourceRowId: "7" }), true);
  assert.equal(isDuplicateSnapshot(snapshots, { sourceType: "dnb_bisnode", snapshotDate: "2026-08-23", sourceRowId: "7" }), false);
  assert.equal(isDuplicateSnapshot(snapshots, { sourceType: "sales_navigator", snapshotDate: "2026-08-22", sourceRowId: "7" }), false);
});