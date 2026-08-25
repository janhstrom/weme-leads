import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  leadCandidateEvidenceTable,
  leadCandidateSourcesTable,
  leadCandidatesTable,
  leadMonitoringRunItemsTable,
  leadMonitoringRunsTable,
  signalpilotSignalsTable,
  type CandidateCrmEnrichment,
  type SignalContact,
} from "@workspace/db";
import {
  CreateCandidateSourceBody,
  CreateCandidateSourceParams,
  CreateCandidateSourceResponse,
  GetLatestMonitoringRunResponse,
  ListCandidateSourcesParams,
  ListCandidateSourcesResponse,
  ListMonitoringActionsResponse,
  StartMonitoringRunResponse,
} from "@workspace/api-zod";
import { enrichCandidateFromCrm } from "../lib/candidate-crm";
import { toSignalResponse } from "./signalpilot";

const router: IRouter = Router();
const REQUEST_TIMEOUT_MS = 6_000;
const RUN_LOCK_MAX_AGE_MS = 60 * 60 * 1_000;
const MAX_SOURCE_ENTRY_AGE_DAYS = 180;
const CHANGE_KEYWORDS = /\b(nedbemanning|omstilling|omorganiser|organisasjonsendring|strategi|strategisk|oppkjøp|fusjon|sammenslå|lanser|digital|teknologi|automatis|kunst(ig)? intelligens|ai\b|kompetanse|opplæring|lederskap|workforce|restructur|transformation|acquisition|merger|launch|digitali[sz]|automation|workforce adjustment)\b/i;
let activeMonitoringJob: Promise<MonitoringRun> | null = null;

type Candidate = typeof leadCandidatesTable.$inferSelect;
type CandidateSource = typeof leadCandidateSourcesTable.$inferSelect;
type MonitoringRun = typeof leadMonitoringRunsTable.$inferSelect;
type FeedEntry = { title: string; url: string; publishedAt: string; excerpt: string };

function plainText(value: string | undefined) {
  return (value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return plainText(match?.[1]);
}

function feedDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1_000) return null;
  if ((Date.now() - date.getTime()) / (24 * 60 * 60 * 1_000) > MAX_SOURCE_ENTRY_AGE_DAYS) return null;
  return date.toISOString().slice(0, 10);
}

function parseFeed(xml: string): FeedEntry[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((match) => match[1] ?? "");

  return blocks.flatMap((block) => {
    const atomLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
    const url = atomLink ?? xmlTag(block, "link");
    const publishedAt = feedDate(xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated"));
    const title = xmlTag(block, "title");
    const excerpt = xmlTag(block, "description") || xmlTag(block, "summary") || xmlTag(block, "content");
    try {
      if (!title || !publishedAt || !url || new URL(url).protocol !== "https:") return [];
    } catch {
      return [];
    }
    return [{ title, url, publishedAt, excerpt: excerpt || title }];
  });
}

async function fetchTextWithTimeout(url: string, method: "GET" | "HEAD" = "GET") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: method === "GET" ? { Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html" } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Kilden svarte ikke innen seks sekunder.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyPublicUrl(url: string) {
  let response = await fetchTextWithTimeout(url, "HEAD");
  if (response.status === 405) response = await fetchTextWithTimeout(url, "GET");
  return response.ok;
}

async function brregStatus(organizationNumber: string | null) {
  const normalized = organizationNumber?.replace(/\D/g, "") ?? "";
  if (normalized.length !== 9) return "not_available";
  try {
    await fetchTextWithTimeout(`https://data.brreg.no/enhetsregisteret/api/enheter/${normalized}`);
    return "verified";
  } catch (error) {
    return error instanceof Error && error.message === "HTTP 404" ? "not_found" : "unavailable";
  }
}

function candidateSourceResponse(source: CandidateSource) {
  return {
    id: source.id,
    candidateId: source.candidateId,
    sourceType: source.sourceType,
    url: source.url,
    label: source.label,
    isActive: source.isActive === "true",
    lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
    lastError: source.lastError,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

function monitoringRunResponse(run: MonitoringRun) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    requestedCount: run.requestedCount,
    processedCount: run.processedCount,
    signalsCreated: run.signalsCreated,
    crmMatchedCount: run.crmMatchedCount,
    crmUnresolvedCount: run.crmUnresolvedCount,
    sourceErrorCount: run.sourceErrorCount,
    errorSummary: run.errorSummary,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function contactsForSignal(crm: CandidateCrmEnrichment | null): SignalContact[] {
  if (!crm || crm.status !== "matched") {
    return [{
      id: -1,
      name: "Anbefalt kontaktrolle",
      title: "HR-, endrings- eller kompetanseansvarlig",
      confidence: "fra_sales_navigator",
      rationale: "CRM ga ikke en sikker kontakt. Velg relevant rolle fra historiske observasjoner eller CRM etter avklaring.",
    }];
  }
  const contacts = crm.relevantContacts.slice(0, 3).map((contact) => ({
    id: contact.id,
    crmContactId: contact.id,
    name: contact.name,
    title: contact.title ?? contact.contactRole ?? "Relevant rolle",
    email: contact.email,
    confidence: "fra_crm" as const,
    rationale: "Relevant rolle fra et sikkert CRM-selskaptreff.",
  }));
  return contacts.length ? contacts : [{
    id: -1,
    name: "Anbefalt kontaktrolle",
    title: "HR-, endrings- eller kompetanseansvarlig",
    confidence: "fra_sales_navigator",
    rationale: "Sikkert CRM-selskaptreff, men ingen relevant kontaktrolle var registrert.",
  }];
}

async function refreshCrm(candidate: Candidate) {
  const crmEnrichment = await enrichCandidateFromCrm({
    companyName: candidate.companyName,
    organizationNumber: candidate.organizationNumber,
    domain: candidate.domain,
  }, {
    apiKey: process.env.WEME_CRM_API_KEY,
    baseUrl: process.env.WEME_CRM_BASE_URL,
  });
  await db.update(leadCandidatesTable).set({
    crmEnrichment,
    crmEnrichedAt: new Date(crmEnrichment.evaluatedAt),
    lastAnalyzedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(leadCandidatesTable.id, candidate.id));
  return crmEnrichment;
}

async function collectSignals(candidate: Candidate, crm: CandidateCrmEnrichment, runId: number) {
  const sources = await db.select().from(leadCandidateSourcesTable).where(and(
    eq(leadCandidateSourcesTable.candidateId, candidate.id),
    eq(leadCandidateSourcesTable.isActive, "true"),
  ));
  let created = 0;
  let sourceErrors = 0;
  for (const source of sources) {
    try {
      const xml = await (await fetchTextWithTimeout(source.url)).text();
      const entries = parseFeed(xml).filter((entry) => CHANGE_KEYWORDS.test(`${entry.title} ${entry.excerpt}`));
      for (const entry of entries) {
        await verifyPublicUrl(entry.url);
        const signalKey = createHash("sha256").update(`${candidate.id}|${entry.url}`).digest("hex");
        const excerpt = plainText(entry.excerpt).slice(0, 900);
        const actionPriority = candidate.priorityScore + (crm.status === "matched" ? 15 : 0) + 20;
        const [inserted] = await db.insert(signalpilotSignalsTable).values({
          companyName: candidate.companyName,
          employees: candidate.employees ?? 0,
          industry: candidate.industry ?? "Ikke oppgitt",
          domain: candidate.domain ?? "",
          signalType: "Offentlig endringssignal",
          strength: actionPriority >= 50 ? "A" : "B",
          status: "til_vurdering",
          summary: excerpt,
          rationale: "Offisiell kilde omtaler en endring som kan kreve forankring, kompetansebygging eller lederstøtte.",
          publishedAt: entry.publishedAt,
          evidence: [{
            title: entry.title,
            url: entry.url,
            sourceType: source.label,
            publishedAt: entry.publishedAt,
            excerpt,
            verificationStatus: "url_verified",
            verifiedAt: new Date().toISOString(),
          }],
          contacts: contactsForSignal(crm),
          crm: {
            status: crm.status === "matched" ? "Sikkert CRM-treff" : crm.status === "ambiguous" ? "Flere mulige CRM-treff" : crm.status === "unavailable" ? "CRM midlertidig utilgjengelig" : "Ingen sikker CRM-match",
            matchCount: crm.status === "matched" ? 1 : 0,
            note: crm.availabilityMessage,
          },
          suggestedOpening: "Jeg så at dere nylig har kommunisert en endring. Hva er viktigst for at ledere og medarbeidere skal lykkes i den neste fasen?",
          dialogueDraft: `Jeg så den offentlige oppdateringen om ${entry.title}. WeMe hjelper virksomheter med å gjøre endringer konkrete og gjennomførbare i arbeidshverdagen.`,
          candidateId: candidate.id,
          monitoringRunId: runId,
          signalKey,
          actionPriority,
          isActionable: true,
        }).onConflictDoNothing({ target: signalpilotSignalsTable.signalKey }).returning({ id: signalpilotSignalsTable.id });
        if (inserted) {
          created += 1;
          await db.insert(leadCandidateEvidenceTable).values({
            candidateId: candidate.id,
            title: entry.title,
            url: entry.url,
            sourceType: source.label,
            publishedAt: entry.publishedAt,
            excerpt,
            verificationStatus: "url_verified",
          }).onConflictDoNothing();
        }
      }
      await db.update(leadCandidateSourcesTable).set({ lastCheckedAt: new Date(), lastError: null }).where(eq(leadCandidateSourcesTable.id, source.id));
    } catch (error) {
      sourceErrors += 1;
      await db.update(leadCandidateSourcesTable).set({
        lastCheckedAt: new Date(),
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Ukjent kildefeil",
      }).where(eq(leadCandidateSourcesTable.id, source.id));
    }
  }
  return { created, sourceErrors };
}

async function expireStaleRunLocks() {
  const running = await db.select().from(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.status, "running"));
  const staleBefore = Date.now() - RUN_LOCK_MAX_AGE_MS;
  for (const run of running) {
    if (run.startedAt.getTime() < staleBefore) {
      await db.update(leadMonitoringRunsTable).set({
        status: "failed",
        completedAt: new Date(),
        errorSummary: "Kjøringen ble avsluttet fordi låsen var eldre enn én time.",
      }).where(eq(leadMonitoringRunsTable.id, run.id));
    }
  }
}

export class MonitoringRunInProgressError extends Error {}

export async function runMonitoringScan(trigger: "manual" | "scheduled") {
  await expireStaleRunLocks();
  const [activeRun] = await db.select().from(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.status, "running")).orderBy(desc(leadMonitoringRunsTable.startedAt));
  if (activeRun) throw new MonitoringRunInProgressError("En overvåkningskjøring pågår allerede.");

  const candidates = await db.select().from(leadCandidatesTable).where(eq(leadCandidatesTable.monitoringStatus, "monitoring")).orderBy(desc(leadCandidatesTable.priorityScore));
  const [run] = await db.insert(leadMonitoringRunsTable).values({
    status: "running",
    trigger,
    requestedCount: candidates.length,
  }).returning();

  let processedCount = 0;
  let signalsCreated = 0;
  let crmMatchedCount = 0;
  let crmUnresolvedCount = 0;
  let sourceErrorCount = 0;
  const failures: string[] = [];

  for (const candidate of candidates) {
    let crmStatus = "not_run";
    let brreg = "not_available";
    try {
      const [crm, brregResult] = await Promise.all([refreshCrm(candidate), brregStatus(candidate.organizationNumber)]);
      crmStatus = crm.status;
      brreg = brregResult;
      if (crm.status === "matched") crmMatchedCount += 1;
      if (crm.status === "not_found" || crm.status === "ambiguous" || crm.status === "unavailable") crmUnresolvedCount += 1;
      const collected = await collectSignals(candidate, crm, run.id);
      processedCount += 1;
      signalsCreated += collected.created;
      sourceErrorCount += collected.sourceErrors;
      await db.insert(leadMonitoringRunItemsTable).values({
        runId: run.id,
        candidateId: candidate.id,
        status: collected.sourceErrors ? "processed" : "processed",
        brregStatus: brreg,
        crmStatus,
        signalsCreated: collected.created,
        sourceErrorCount: collected.sourceErrors,
        message: collected.sourceErrors ? "En eller flere konfigurerte kilder kunne ikke hentes." : null,
      });
    } catch (error) {
      failures.push(`${candidate.companyName}: ${error instanceof Error ? error.message : "ukjent feil"}`);
      await db.insert(leadMonitoringRunItemsTable).values({
        runId: run.id,
        candidateId: candidate.id,
        status: "failed",
        brregStatus: brreg,
        crmStatus,
        signalsCreated: 0,
        sourceErrorCount: 0,
        message: failures.at(-1)?.slice(0, 1_000) ?? "Ukjent feil",
      });
    }
  }

  const [completed] = await db.update(leadMonitoringRunsTable).set({
    status: failures.length || sourceErrorCount ? "completed_with_errors" : "completed",
    processedCount,
    signalsCreated,
    crmMatchedCount,
    crmUnresolvedCount,
    sourceErrorCount,
    errorSummary: failures.length ? failures.slice(0, 3).join(" · ") : null,
    completedAt: new Date(),
  }).where(eq(leadMonitoringRunsTable.id, run.id)).returning();
  return completed;
}

router.get("/monitoring/actions", async (_req, res): Promise<void> => {
  const freshSince = new Date(Date.now() - MAX_SOURCE_ENTRY_AGE_DAYS * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const signals = await db.select().from(signalpilotSignalsTable).where(and(
    eq(signalpilotSignalsTable.status, "til_vurdering"),
    eq(signalpilotSignalsTable.isActionable, true),
  )).orderBy(desc(signalpilotSignalsTable.actionPriority), desc(signalpilotSignalsTable.publishedAt));
  res.json(ListMonitoringActionsResponse.parse(
    signals.filter((signal) => signal.publishedAt >= freshSince).map(toSignalResponse),
  ));
});

router.get("/monitoring/runs/latest", async (_req, res): Promise<void> => {
  const [run] = await db.select().from(leadMonitoringRunsTable).orderBy(desc(leadMonitoringRunsTable.startedAt)).limit(1);
  if (!run) {
    res.status(404).json({ error: "Ingen overvåkningskjøring er registrert ennå." });
    return;
  }
  res.json(GetLatestMonitoringRunResponse.parse(monitoringRunResponse(run)));
});

router.post("/monitoring/runs", async (_req, res): Promise<void> => {
  if (activeMonitoringJob) {
    res.status(409).json({ error: "En overvåkningskjøring pågår allerede." });
    return;
  }
  const job = runMonitoringScan("manual");
  activeMonitoringJob = job;
  void job.catch(() => undefined).finally(() => {
    activeMonitoringJob = null;
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [run] = await db.select().from(leadMonitoringRunsTable).orderBy(desc(leadMonitoringRunsTable.startedAt)).limit(1);
    if (run) {
      res.json(StartMonitoringRunResponse.parse(monitoringRunResponse(run)));
      return;
    }
  }
  try {
    const run = await job;
    res.json(StartMonitoringRunResponse.parse(monitoringRunResponse(run)));
  } catch (error) {
    if (error instanceof MonitoringRunInProgressError) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: error instanceof Error ? error.message : "Overvåkningskjøringen feilet." });
    }
  }
});

router.get("/candidates/:id/sources", async (req, res): Promise<void> => {
  const params = ListCandidateSourcesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ugyldig kandidat-ID." });
    return;
  }
  const [candidate] = await db.select({ id: leadCandidatesTable.id }).from(leadCandidatesTable).where(eq(leadCandidatesTable.id, params.data.id));
  if (!candidate) {
    res.status(404).json({ error: "Kandidaten finnes ikke." });
    return;
  }
  const sources = await db.select().from(leadCandidateSourcesTable).where(eq(leadCandidateSourcesTable.candidateId, candidate.id));
  res.json(ListCandidateSourcesResponse.parse(sources.map(candidateSourceResponse)));
});

router.post("/candidates/:id/sources", async (req, res): Promise<void> => {
  const params = CreateCandidateSourceParams.safeParse(req.params);
  const body = CreateCandidateSourceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Kildetype, navn og gyldig HTTPS-feed-URL er påkrevd." });
    return;
  }
  let url: URL;
  try {
    url = new URL(body.data.url);
  } catch {
    res.status(400).json({ error: "Kilde-URL-en er ugyldig." });
    return;
  }
  if (url.protocol !== "https:") {
    res.status(400).json({ error: "Kilden må bruke HTTPS." });
    return;
  }
  const [candidate] = await db.select({ id: leadCandidatesTable.id }).from(leadCandidatesTable).where(eq(leadCandidatesTable.id, params.data.id));
  if (!candidate) {
    res.status(404).json({ error: "Kandidaten finnes ikke." });
    return;
  }
  try {
    const [source] = await db.insert(leadCandidateSourcesTable).values({
      candidateId: candidate.id,
      sourceType: body.data.sourceType,
      url: url.toString(),
      label: body.data.label.trim(),
    }).returning();
    res.status(201).json(CreateCandidateSourceResponse.parse(candidateSourceResponse(source)));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Denne kilden er allerede registrert for kandidaten." });
      return;
    }
    throw error;
  }
});

export default router;