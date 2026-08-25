import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  leadAnalysisBatchesTable,
  leadCandidateEvidenceTable,
  leadCandidatesTable,
  leadCandidateSnapshotsTable,
  signalpilotSignalsTable,
  type CandidateMatchStatus,
  type CandidateMonitoringStatus,
  type CandidateRelevanceStatus,
  type CandidateSnapshotData,
} from "@workspace/db";
import {
  AddCandidateEvidenceBody,
  AddCandidateEvidenceParams,
  AddCandidateEvidenceResponse,
  BulkUpdateCandidateRelevanceBody,
  BulkUpdateCandidateRelevanceResponse,
  CorrectCandidateSnapshotDateBody,
  CorrectCandidateSnapshotDateResponse,
  CreateCandidateAnalysisBatchBody,
  CreateCandidateAnalysisBatchResponse,
  GetCandidateParams,
  GetCandidateResponse,
  ImportCandidateSnapshotsBody,
  ImportCandidateSnapshotsResponse,
  ListCandidatesQueryParams,
  ListCandidatesResponse,
  UpdateCandidateMonitoringBody,
  UpdateCandidateMonitoringParams,
  UpdateCandidateMonitoringResponse,
  UpdateCandidateRelevanceBody,
  UpdateCandidateRelevanceParams,
  UpdateCandidateRelevanceResponse,
} from "@workspace/api-zod";
import {
  isDuplicateSnapshot,
  matchImportedCompany,
  normalizeCandidateDomain,
  normalizeCandidateName,
} from "../lib/candidate-matching";

const router: IRouter = Router();
const DAY = 1000 * 60 * 60 * 24;
const EVIDENCE_CHECK_TIMEOUT_MS = 6_000;
const relevantRolePattern = /\b(hr|human resources|people|transform|endring|change|digital|ai|strategi|strategy|program|learning|kompetanse)\b/i;

type CandidateRecord = typeof leadCandidatesTable.$inferSelect;
type CandidateSnapshotRecord = typeof leadCandidateSnapshotsTable.$inferSelect;
type CandidateEvidenceRecord = typeof leadCandidateEvidenceTable.$inferSelect;

function nullable(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function inferRelevance(priorityScore: number, priorityReasons: string[]) {
  if (priorityScore >= 25) {
    return {
      relevanceStatus: "relevant" as const,
      relevanceReason: priorityReasons[0] ?? "Systemvurdering basert på tilgjengelig kildegrunnlag.",
    };
  }
  if (priorityScore > 0) {
    return {
      relevanceStatus: "possible" as const,
      relevanceReason: priorityReasons[0] ?? "Noe kildegrunnlag finnes, men trenger vurdering.",
    };
  }
  return {
    relevanceStatus: "possible" as const,
    relevanceReason: "Begrenset kildegrunnlag: beholdt som mulig relevant, men ikke lagt i manuell vurderingskø.",
  };
}

function calculatePriority(candidate: CandidateRecord, snapshots: CandidateSnapshotRecord[]) {
  const reasons: string[] = [];
  let score = 0;
  const employeeSnapshots = snapshots
    .filter((snapshot) => snapshot.data.employees !== null && snapshot.data.employees !== undefined)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

  if ((candidate.employees ?? 0) >= 250) {
    score += 20;
    reasons.push("ICP-fit: minst 250 ansatte");
  }
  if ((candidate.employees ?? 0) >= 1_000) {
    score += 10;
    reasons.push("Størrelse: over 1 000 ansatte");
  }
  if (employeeSnapshots.length >= 2) {
    const previous = employeeSnapshots.at(-2)?.data.employees ?? 0;
    const latest = employeeSnapshots.at(-1)?.data.employees ?? 0;
    const difference = latest - previous;
    if (difference !== 0) {
      score += Math.min(30, 12 + Math.round(Math.abs(difference) / Math.max(previous, 1) * 100));
      reasons.push(`D&B/Bisnode: ${difference > 0 ? "+" : ""}${difference} ansatte siden forrige snapshot`);
    }
  }

  const relevantRoles = snapshots.filter(
    (snapshot) => snapshot.sourceType === "sales_navigator" && relevantRolePattern.test(snapshot.data.roleTitle ?? ""),
  );
  if (relevantRoles.length > 0) {
    score += Math.min(25, 10 + relevantRoles.length * 5);
    reasons.push(`Sales Navigator: ${relevantRoles.length} relevant${relevantRoles.length === 1 ? " rolle" : "e roller"} observert`);
  }

  const latestSnapshot = snapshots.reduce<Date | null>((latest, snapshot) => {
    const current = new Date(snapshot.snapshotDate);
    return !latest || current > latest ? current : latest;
  }, null);
  if (latestSnapshot && (Date.now() - latestSnapshot.getTime()) / DAY <= 90) {
    score += 5;
    reasons.push("Aktualitet: kilde oppdatert siste 90 dager");
  }
  if (reasons.length === 0) reasons.push("Trenger mer kildegrunnlag før prioritering");
  return { score, reasons };
}

function calculateChanges(snapshots: CandidateSnapshotRecord[]) {
  const changes: { kind: "employee_change" | "relevant_role" | "source_refresh"; label: string; detail: string }[] = [];
  const employeeSnapshots = snapshots
    .filter((snapshot) => snapshot.data.employees !== null && snapshot.data.employees !== undefined)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  if (employeeSnapshots.length >= 2) {
    const previous = employeeSnapshots.at(-2)!;
    const latest = employeeSnapshots.at(-1)!;
    const difference = (latest.data.employees ?? 0) - (previous.data.employees ?? 0);
    if (difference !== 0) {
      changes.push({
        kind: "employee_change",
        label: "Endring i ansatte",
        detail: `${previous.data.employees} → ${latest.data.employees} fra ${previous.snapshotDate} til ${latest.snapshotDate}`,
      });
    }
  }
  for (const snapshot of snapshots.filter((item) => item.sourceType === "sales_navigator" && relevantRolePattern.test(item.data.roleTitle ?? "")).slice(0, 3)) {
    changes.push({
      kind: "relevant_role",
      label: "Relevant rolle i Sales Navigator",
      detail: [snapshot.data.personName, snapshot.data.roleTitle].filter(Boolean).join(" — "),
    });
  }
  for (const sourceType of new Set(snapshots.map((snapshot) => snapshot.sourceType))) {
    const latest = snapshots
      .filter((snapshot) => snapshot.sourceType === sourceType)
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
    if (latest) {
      changes.push({ kind: "source_refresh", label: sourceLabel(sourceType), detail: `Siste snapshot: ${latest.snapshotDate}` });
    }
  }
  return changes;
}

function sourceLabel(sourceType: string) {
  return {
    dnb_bisnode: "D&B/Bisnode",
    sales_navigator: "Sales Navigator",
    manual: "Manuell kilde",
  }[sourceType] ?? sourceType;
}

function evidenceResponse(evidence: CandidateEvidenceRecord) {
  return {
    title: evidence.title,
    url: evidence.url,
    sourceType: evidence.sourceType,
    publishedAt: evidence.publishedAt,
    excerpt: evidence.excerpt,
    verificationStatus: "url_verified" as const,
    verifiedAt: evidence.verifiedAt,
  };
}

async function toCandidateResponse(candidate: CandidateRecord) {
  const [snapshots, evidence] = await Promise.all([
    db.select().from(leadCandidateSnapshotsTable).where(eq(leadCandidateSnapshotsTable.candidateId, candidate.id)).orderBy(desc(leadCandidateSnapshotsTable.snapshotDate)),
    db.select().from(leadCandidateEvidenceTable).where(eq(leadCandidateEvidenceTable.candidateId, candidate.id)).orderBy(desc(leadCandidateEvidenceTable.publishedAt)),
  ]);
  return {
    id: candidate.id,
    companyName: candidate.companyName,
    organizationNumber: candidate.organizationNumber,
    domain: candidate.domain,
    industry: candidate.industry,
    employees: candidate.employees,
    matchStatus: candidate.matchStatus,
    relevanceStatus: candidate.relevanceStatus,
    relevanceReason: candidate.relevanceReason,
    relevanceSource: candidate.relevanceSource,
    monitoringStatus: candidate.monitoringStatus,
    monitoringReason: candidate.monitoringReason,
    priorityScore: candidate.priorityScore,
    priorityReasons: candidate.priorityReasons,
    lastAnalyzedAt: candidate.lastAnalyzedAt,
    snapshots: snapshots.map((snapshot) => ({
      id: snapshot.id,
      sourceType: snapshot.sourceType as "dnb_bisnode" | "sales_navigator" | "manual",
      sourceRowId: snapshot.sourceRowId,
      snapshotDate: snapshot.snapshotDate,
      originalCompanyName: snapshot.originalCompanyName,
      importedAt: snapshot.importedAt,
      data: snapshot.data,
    })),
    changes: calculateChanges(snapshots),
    evidence: evidence.map(evidenceResponse),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

async function refreshCandidatePriority(candidateId: number) {
  const [candidate] = await db.select().from(leadCandidatesTable).where(eq(leadCandidatesTable.id, candidateId));
  if (!candidate) return;
  const snapshots = await db.select().from(leadCandidateSnapshotsTable).where(eq(leadCandidateSnapshotsTable.candidateId, candidateId));
  const priority = calculatePriority(candidate, snapshots);
  const systemRelevance = inferRelevance(priority.score, priority.reasons);
  await db
    .update(leadCandidatesTable)
    .set({
      priorityScore: priority.score,
      priorityReasons: priority.reasons,
      ...(candidate.relevanceSource === "system" ? systemRelevance : {}),
      updatedAt: new Date(),
    })
    .where(eq(leadCandidatesTable.id, candidateId));
}

async function ensureCandidatesFromSignals() {
  const signals = await db.select().from(signalpilotSignalsTable);
  const candidates = await db.select().from(leadCandidatesTable);
  for (const signal of signals) {
    let candidate = candidates.find((item) => item.normalizedName === normalizeCandidateName(signal.companyName));
    if (!candidate) {
      const [created] = await db
        .insert(leadCandidatesTable)
        .values({
          companyName: signal.companyName,
          normalizedName: normalizeCandidateName(signal.companyName),
          domain: normalizeCandidateDomain(signal.domain),
          industry: signal.industry,
          employees: signal.employees,
          matchStatus: "new",
          relevanceStatus: "relevant",
          relevanceReason: "Eksisterende, kildebelagt signal fra pilotgrunnlaget.",
          relevanceSource: "system",
          monitoringStatus: "monitoring",
          monitoringReason: "Startet i overvåkning fra eksisterende, kildebelagt signal.",
          priorityScore: signal.strength === "A" ? 35 : 25,
          priorityReasons: ["Startkandidat fra eksisterende, kildebelagt signal"],
        })
        .returning();
      candidate = created;
      candidates.push(candidate);
      await db.insert(leadCandidateSnapshotsTable).values({
        candidateId: candidate.id,
        sourceType: "manual",
        snapshotDate: signal.publishedAt,
        originalCompanyName: signal.companyName,
        data: { employees: signal.employees, fields: { "Opprinnelse": "Eksisterende WeMe Leads-signal" } },
      });
    }
    if (
      candidate.priorityReasons.includes("Startkandidat fra eksisterende, kildebelagt signal") &&
      candidate.relevanceStatus === "needs_review"
    ) {
      const updates = {
        relevanceStatus: "relevant" as CandidateRelevanceStatus,
        relevanceReason: "Eksisterende, kildebelagt signal fra pilotgrunnlaget.",
        relevanceSource: "system" as const,
        monitoringStatus: "monitoring" as CandidateMonitoringStatus,
        monitoringReason: "Startet i overvåkning fra eksisterende, kildebelagt signal.",
      };
      await db.update(leadCandidatesTable).set(updates).where(eq(leadCandidatesTable.id, candidate.id));
      Object.assign(candidate, updates);
    }
    const existingEvidence = await db
      .select({ url: leadCandidateEvidenceTable.url })
      .from(leadCandidateEvidenceTable)
      .where(eq(leadCandidateEvidenceTable.candidateId, candidate.id));
    const existingUrls = new Set(existingEvidence.map((item) => item.url));
    for (const evidence of signal.evidence) {
      if (existingUrls.has(evidence.url)) continue;
      await db.insert(leadCandidateEvidenceTable).values({
        candidateId: candidate.id,
        title: evidence.title,
        url: evidence.url,
        sourceType: evidence.sourceType,
        publishedAt: evidence.publishedAt,
        excerpt: evidence.excerpt,
        verificationStatus: "url_verified",
        verifiedAt: new Date(evidence.verifiedAt),
      });
    }
  }
}

async function verifyPublicEvidence(input: { title: string; url: string; sourceType: string; publishedAt: string; excerpt: string }) {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error("Kilden må være en gyldig URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Kilden må bruke HTTPS.");
  if (input.title.trim().length < 5 || input.excerpt.trim().length < 20) {
    throw new Error("Kilden må ha en kvalitetssikret tittel og et sitat på minst 20 tegn.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EVIDENCE_CHECK_TIMEOUT_MS);
  try {
    let response = await fetch(parsed, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (response.status === 405) response = await fetch(parsed, { method: "GET", redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`Kilden kunne ikke kontrolleres (HTTP ${response.status}).`);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Kildekontrollen tok mer enn seks sekunder.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  return { ...input, title: input.title.trim(), excerpt: input.excerpt.trim() };
}

router.get("/candidates", async (req, res): Promise<void> => {
  const query = ListCandidatesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  await ensureCandidatesFromSignals();
  let candidates = await db.select().from(leadCandidatesTable).orderBy(desc(leadCandidatesTable.priorityScore), asc(leadCandidatesTable.companyName));
  if (query.data.search) {
    const needle = query.data.search.toLocaleLowerCase("nb-NO");
    candidates = candidates.filter((candidate) =>
      [candidate.companyName, candidate.domain, candidate.industry].filter(Boolean).join(" ").toLocaleLowerCase("nb-NO").includes(needle),
    );
  }
  if (query.data.view === "monitoring") {
    candidates = candidates.filter((candidate) => candidate.monitoringStatus === "monitoring");
  }
  if (query.data.view === "review") {
    candidates = candidates.filter(
      (candidate) => candidate.relevanceStatus === "needs_review" || candidate.matchStatus === "needs_review",
    );
  }
  if (query.data.relevanceStatus) {
    candidates = candidates.filter((candidate) => candidate.relevanceStatus === query.data.relevanceStatus);
  }
  const response = await Promise.all(candidates.map(toCandidateResponse));
  res.json(ListCandidatesResponse.parse(response));
});

router.get("/candidates/:id", async (req, res): Promise<void> => {
  const params = GetCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await ensureCandidatesFromSignals();
  const [candidate] = await db.select().from(leadCandidatesTable).where(eq(leadCandidatesTable.id, params.data.id));
  if (!candidate) {
    res.status(404).json({ error: "Kandidaten finnes ikke." });
    return;
  }
  res.json(GetCandidateResponse.parse(await toCandidateResponse(candidate)));
});

router.patch("/candidates/snapshot-date", async (req, res): Promise<void> => {
  const body = CorrectCandidateSnapshotDateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Velg gyldig kilde og begge snapshot-datoene." });
    return;
  }
  const fromSnapshotDate = dateOnly(body.data.fromSnapshotDate);
  const toSnapshotDate = dateOnly(body.data.toSnapshotDate);
  if (fromSnapshotDate === toSnapshotDate) {
    res.status(400).json({ error: "Den nye snapshot-datoen må være forskjellig fra dagens dato." });
    return;
  }
  const snapshots = await db
    .select({ candidateId: leadCandidateSnapshotsTable.candidateId })
    .from(leadCandidateSnapshotsTable)
    .where(and(
      eq(leadCandidateSnapshotsTable.sourceType, body.data.sourceType),
      eq(leadCandidateSnapshotsTable.snapshotDate, fromSnapshotDate),
    ));
  if (snapshots.length > 0) {
    await db
      .update(leadCandidateSnapshotsTable)
      .set({ snapshotDate: toSnapshotDate })
      .where(and(
        eq(leadCandidateSnapshotsTable.sourceType, body.data.sourceType),
        eq(leadCandidateSnapshotsTable.snapshotDate, fromSnapshotDate),
      ));
    for (const candidateId of new Set(snapshots.map((snapshot) => snapshot.candidateId))) {
      await refreshCandidatePriority(candidateId);
    }
  }
  res.json(CorrectCandidateSnapshotDateResponse.parse({ updatedCount: snapshots.length }));
});

router.patch("/candidates/:id/relevance", async (req, res): Promise<void> => {
  const params = UpdateCandidateRelevanceParams.safeParse(req.params);
  const body = UpdateCandidateRelevanceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Velg en gyldig relevansstatus." });
    return;
  }
  await ensureCandidatesFromSignals();
  const [candidate] = await db
    .update(leadCandidatesTable)
    .set({
      relevanceStatus: body.data.relevanceStatus,
      relevanceReason: nullable(body.data.reason),
      relevanceSource: "manual",
      updatedAt: new Date(),
    })
    .where(eq(leadCandidatesTable.id, params.data.id))
    .returning();
  if (!candidate) {
    res.status(404).json({ error: "Selskapet finnes ikke i hovedlisten." });
    return;
  }
  res.json(UpdateCandidateRelevanceResponse.parse(await toCandidateResponse(candidate)));
});

router.patch("/candidates/relevance/bulk", async (req, res): Promise<void> => {
  const body = BulkUpdateCandidateRelevanceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Velg minst én kandidat og en gyldig relevansstatus." });
    return;
  }
  const candidateIds = [...new Set(body.data.candidateIds)];
  const updated = await db
    .update(leadCandidatesTable)
    .set({
      relevanceStatus: body.data.relevanceStatus,
      relevanceReason: nullable(body.data.reason),
      relevanceSource: "manual",
      updatedAt: new Date(),
    })
    .where(inArray(leadCandidatesTable.id, candidateIds))
    .returning({ id: leadCandidatesTable.id });
  res.json(BulkUpdateCandidateRelevanceResponse.parse({
    updatedCount: updated.length,
    relevanceStatus: body.data.relevanceStatus,
  }));
});

router.patch("/candidates/:id/monitoring", async (req, res): Promise<void> => {
  const params = UpdateCandidateMonitoringParams.safeParse(req.params);
  const body = UpdateCandidateMonitoringBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Velg om selskapet skal overvåkes eller ikke." });
    return;
  }
  await ensureCandidatesFromSignals();
  const [candidate] = await db
    .update(leadCandidatesTable)
    .set({
      monitoringStatus: body.data.monitoringStatus,
      monitoringReason: nullable(body.data.reason),
      updatedAt: new Date(),
    })
    .where(eq(leadCandidatesTable.id, params.data.id))
    .returning();
  if (!candidate) {
    res.status(404).json({ error: "Selskapet finnes ikke i hovedlisten." });
    return;
  }
  res.json(UpdateCandidateMonitoringResponse.parse(await toCandidateResponse(candidate)));
});

router.post("/candidates/import", async (req, res): Promise<void> => {
  const body = ImportCandidateSnapshotsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Importen mangler selskapsnavn, kilde eller snapshot-dato." });
    return;
  }
  const existingCandidates = await db.select().from(leadCandidatesTable);
  let created = 0;
  let matched = 0;
  let needsReview = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const record of body.data.records) {
    const companyName = record.companyName.trim();
    if (companyName.length < 2) {
      skipped += 1;
      warnings.push("En rad mangler gyldig selskapsnavn.");
      continue;
    }
    const organizationNumber = nullable(record.organizationNumber);
    const domain = normalizeCandidateDomain(record.domain);
    const normalizedName = normalizeCandidateName(companyName);
    const match = matchImportedCompany({ companyName, organizationNumber, domain }, existingCandidates);
    let candidate = match.candidate ? existingCandidates.find((item) => item.id === match.candidate?.id) : undefined;
    const matchStatus: CandidateMatchStatus = match.status;
    if (matchStatus === "needs_review") needsReview += 1;

    const snapshotDate = dateOnly(body.data.snapshotDate);
    if (candidate) {
      const existingSnapshots = await db
        .select({
          sourceType: leadCandidateSnapshotsTable.sourceType,
          snapshotDate: leadCandidateSnapshotsTable.snapshotDate,
          sourceRowId: leadCandidateSnapshotsTable.sourceRowId,
        })
        .from(leadCandidateSnapshotsTable)
        .where(eq(leadCandidateSnapshotsTable.candidateId, candidate.id));
      if (isDuplicateSnapshot(existingSnapshots, { sourceType: body.data.sourceType, snapshotDate, sourceRowId: record.sourceRowId })) {
        skipped += 1;
        warnings.push(`${companyName}: identisk kilde-rad finnes allerede for dette snapshotet.`);
        continue;
      }
    }
    if (!candidate) {
      const [createdCandidate] = await db
        .insert(leadCandidatesTable)
        .values({
          companyName,
          normalizedName,
          organizationNumber,
          domain,
          industry: nullable(record.industry),
          employees: record.employees ?? null,
          matchStatus,
          priorityScore: 0,
          priorityReasons: ["Ny kandidat — trenger minst to observasjoner eller relevant rolle for høyere prioritet"],
        })
        .returning();
      candidate = createdCandidate;
      existingCandidates.push(candidate);
      created += 1;
    } else {
      await db
        .update(leadCandidatesTable)
        .set({
          organizationNumber: candidate.organizationNumber ?? organizationNumber,
          domain: candidate.domain ?? domain,
          industry: candidate.industry ?? nullable(record.industry),
          employees: record.employees ?? candidate.employees,
          matchStatus,
          updatedAt: new Date(),
        })
        .where(eq(leadCandidatesTable.id, candidate.id));
      Object.assign(candidate, {
        organizationNumber: candidate.organizationNumber ?? organizationNumber,
        domain: candidate.domain ?? domain,
        industry: candidate.industry ?? nullable(record.industry),
        employees: record.employees ?? candidate.employees,
        matchStatus,
      });
      matched += 1;
    }

    const data: CandidateSnapshotData = {
      employees: record.employees ?? null,
      revenue: nullable(record.revenue),
      owner: nullable(record.owner),
      personName: nullable(record.personName),
      roleTitle: nullable(record.roleTitle),
      profileUrl: nullable(record.profileUrl),
      fields: record.fields ?? {},
    };
    await db.insert(leadCandidateSnapshotsTable).values({
      candidateId: candidate.id,
      sourceType: body.data.sourceType,
      sourceRowId: nullable(record.sourceRowId),
      snapshotDate,
      originalCompanyName: companyName,
      data,
    });
    await refreshCandidatePriority(candidate.id);
  }
  res.status(201).json(ImportCandidateSnapshotsResponse.parse({ created, matched, needsReview, skipped, warnings }));
});

router.post("/candidates/:id/evidence", async (req, res): Promise<void> => {
  const params = AddCandidateEvidenceParams.safeParse(req.params);
  const body = AddCandidateEvidenceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Tittel, HTTPS-URL, publiseringsdato, kildetype og sitat er påkrevd." });
    return;
  }
  const [candidate] = await db.select().from(leadCandidatesTable).where(eq(leadCandidatesTable.id, params.data.id));
  if (!candidate) {
    res.status(404).json({ error: "Kandidaten finnes ikke." });
    return;
  }
  const [existingEvidence] = await db
    .select({ id: leadCandidateEvidenceTable.id })
    .from(leadCandidateEvidenceTable)
    .where(and(eq(leadCandidateEvidenceTable.candidateId, candidate.id), eq(leadCandidateEvidenceTable.url, body.data.url)));
  if (existingEvidence) {
    res.status(409).json({ error: "Denne evidens-URL-en finnes allerede for kandidaten." });
    return;
  }
  try {
    const evidence = await verifyPublicEvidence({ ...body.data, publishedAt: dateOnly(body.data.publishedAt) });
    try {
      await db.insert(leadCandidateEvidenceTable).values({
        candidateId: candidate.id,
        ...evidence,
        verificationStatus: "url_verified",
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Denne evidens-URL-en finnes allerede for kandidaten." });
        return;
      }
      throw error;
    }
    const [updated] = await db.select().from(leadCandidatesTable).where(eq(leadCandidatesTable.id, candidate.id));
    res.status(201).json(AddCandidateEvidenceResponse.parse(await toCandidateResponse(updated)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Kilden kunne ikke kontrolleres." });
  }
});

router.post("/candidates/analysis-batches", async (req, res): Promise<void> => {
  const body = CreateCandidateAnalysisBatchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Velg mellom 1 og 100 kandidater." });
    return;
  }
  await ensureCandidatesFromSignals();
  let candidates = await db.select().from(leadCandidatesTable).orderBy(desc(leadCandidatesTable.priorityScore), asc(leadCandidatesTable.companyName));
  if (body.data.scope === "relevant") {
    candidates = candidates.filter((candidate) => candidate.relevanceStatus === "relevant");
  }
  if (body.data.scope === "monitoring") {
    candidates = candidates.filter((candidate) => candidate.monitoringStatus === "monitoring");
  }
  const requestedCount = body.data.limit ?? candidates.length;
  candidates = body.data.limit ? candidates.slice(0, body.data.limit) : candidates;
  const scopeLabel = {
    universe: "hele hovedlisten",
    relevant: "alle relevante selskaper",
    monitoring: "overvåkningslisten",
  }[body.data.scope];
  const criteria = `Arbeidsliste for ${scopeLabel}. Dette velger selskaper som skal gjennomgås; relevans vurderes fra snapshot-data og CRM brukes ikke til å filtrere ut selskaper.`;
  const [batch] = await db
    .insert(leadAnalysisBatchesTable)
    .values({ requestedCount, selectedCandidateIds: candidates.map((candidate) => candidate.id), criteria })
    .returning();
  if (candidates.length > 0) {
    await db.update(leadCandidatesTable).set({ lastAnalyzedAt: new Date(), updatedAt: new Date() }).where(inArray(leadCandidatesTable.id, candidates.map((candidate) => candidate.id)));
  }
  const updated = await db.select().from(leadCandidatesTable).where(inArray(leadCandidatesTable.id, candidates.map((candidate) => candidate.id)));
  const response = await Promise.all(updated.map(toCandidateResponse));
  res.status(201).json(CreateCandidateAnalysisBatchResponse.parse({
    id: batch.id,
    requestedCount: batch.requestedCount,
    selectedCount: response.length,
    criteria: batch.criteria,
    createdAt: batch.createdAt,
    candidates: response,
  }));
});

export default router;