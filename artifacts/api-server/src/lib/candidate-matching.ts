export type CandidateMatchStatus = "new" | "exact" | "domain_match" | "name_match" | "needs_review";

export type MatchableCandidate = {
  id: number;
  organizationNumber: string | null;
  domain: string | null;
  normalizedName: string;
};

export type ImportedCompany = {
  companyName: string;
  organizationNumber?: string | null;
  domain?: string | null;
};

export function normalizeCandidateName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("nb-NO")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeCandidateDomain(value: string | null | undefined) {
  if (!value) return null;
  return value
    .trim()
    .toLocaleLowerCase("nb-NO")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "") || null;
}

export function matchImportedCompany(input: ImportedCompany, candidates: MatchableCandidate[]) {
  const organizationNumber = input.organizationNumber?.trim() || null;
  const domain = normalizeCandidateDomain(input.domain);
  const normalizedName = normalizeCandidateName(input.companyName);
  const byOrganizationNumber = organizationNumber
    ? candidates.filter((candidate) => candidate.organizationNumber === organizationNumber)
    : [];
  const byDomain = domain ? candidates.filter((candidate) => candidate.domain === domain) : [];
  const byName = candidates.filter((candidate) => candidate.normalizedName === normalizedName);
  const matches = byOrganizationNumber.length ? byOrganizationNumber : byDomain.length ? byDomain : byName;

  if (matches.length > 1) {
    return { candidate: undefined, status: "needs_review" as const, reason: "Flere mulige selskaper matchet samme import-rad." };
  }
  if (matches.length === 1) {
    const status: CandidateMatchStatus = byOrganizationNumber.length === 1
      ? "exact"
      : byDomain.length === 1
        ? "domain_match"
        : "name_match";
    return { candidate: matches[0], status, reason: undefined };
  }
  return { candidate: undefined, status: "new" as const, reason: undefined };
}

export function isDuplicateSnapshot(
  snapshots: Array<{ sourceType: string; snapshotDate: string; sourceRowId: string | null }>,
  input: { sourceType: string; snapshotDate: string; sourceRowId?: string | null },
) {
  return Boolean(input.sourceRowId) && snapshots.some(
    (snapshot) =>
      snapshot.sourceType === input.sourceType &&
      snapshot.snapshotDate === input.snapshotDate &&
      snapshot.sourceRowId === input.sourceRowId,
  );
}