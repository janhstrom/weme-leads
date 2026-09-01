import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  leadCandidateEvidenceTable,
  leadCandidateSnapshotsTable,
  leadCandidateSourcesTable,
  leadCandidatesTable,
  leadMonitoringRunItemsTable,
  leadMonitoringRunsTable,
  signalpilotSignalsTable,
  type CheckedPublicSource,
  type CandidateCrmEnrichment,
  type SignalContact,
} from "@workspace/db";
import {
  CreateCandidateSourceBody,
  CreateCandidateSourceParams,
  CreateCandidateSourceResponse,
  GetLatestEventMappingRunResponse,
  GetLatestMonitoringRunResponse,
  ListEventMappingItemsParams,
  ListEventMappingItemsResponse,
  ListCandidateSourcesParams,
  ListCandidateSourcesResponse,
  ListMonitoringActionsResponse,
  StartMonitoringRunBody,
  StartEventMappingRunResponse,
  StartMonitoringRunResponse,
} from "@workspace/api-zod";
import { enrichCandidateFromCrm } from "../lib/candidate-crm";
import { normalizeCandidateDomain } from "../lib/candidate-matching";
import { toSignalResponse } from "./signalpilot";

const router: IRouter = Router();
const REQUEST_TIMEOUT_MS = 6_000;
const RUN_LOCK_MAX_AGE_MS = 60 * 60 * 1_000;
const MAX_SOURCE_ENTRY_AGE_DAYS = 180;
const CHANGE_KEYWORDS = /\b(nedbemanning|omstilling|omorganiser|organisasjonsendring|strategi|strategisk|oppkjøp|fusjon|sammenslå|lanser|digital|teknologi|automatis|kunst(ig)? intelligens|ai\b|kompetanse|opplæring|lederskap|workforce|restructur|transformation|acquisition|merger|launch|digitali[sz]|automation|workforce adjustment)\b/i;
const HISTORICAL_DOMAIN_FIELDS = new Set(["companydomainname", "companydomain", "companywebsite", "domain", "website", "web", "nettside"]);
let activeMonitoringJob: Promise<MonitoringRun> | null = null;
let activeEventMappingJob: Promise<MonitoringRun> | null = null;

type Candidate = typeof leadCandidatesTable.$inferSelect;
type CandidateSource = typeof leadCandidateSourcesTable.$inferSelect;
type MonitoringRun = typeof leadMonitoringRunsTable.$inferSelect;
type FeedEntry = { title: string; url: string; publishedAt: string; excerpt: string };
type PublicSourceFamily = CheckedPublicSource["family"];
type MappingSource = {
  url: string;
  label: string;
  family: PublicSourceFamily;
  kind: "feed" | "page" | "brreg";
  registeredSourceId?: number;
};
type PublicEvent = FeedEntry & { signalType: string };

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

async function fetchTextWithTimeout(url: string, method: "GET" | "HEAD" = "GET", allowMethodNotAllowed = false, accept = "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: method === "GET" ? { Accept: accept } : undefined,
      signal: controller.signal,
    });
    if (!response.ok && !(allowMethodNotAllowed && response.status === 405)) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Kilden svarte ikke innen seks sekunder.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyPublicUrl(url: string) {
  let response = await fetchTextWithTimeout(url, "HEAD", true);
  if (response.status === 405) response = await fetchTextWithTimeout(url, "GET");
  return response.ok;
}

async function brregStatus(organizationNumber: string | null) {
  const normalized = organizationNumber?.replace(/\D/g, "") ?? "";
  if (normalized.length !== 9) return "not_available";
  try {
    await fetchTextWithTimeout(`https://data.brreg.no/enhetsregisteret/api/enheter/${normalized}`, "GET", false, "application/json");
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
    kind: run.kind,
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

const SIGNAL_MATRIX: Array<{ signalType: string; pattern: RegExp }> = [
  { signalType: "Lederskifte eller ny nøkkelrolle", pattern: /\b(ny|ansetter|utnevnt|tiltrer|appointed|joins?|new)\b.{0,70}\b(leder|direktør|ceo|cto|cfo|hr|people|chief|head of|vp|vice president)\b|\b(leder|direktør|ceo|cto|cfo|hr|people|chief|head of|vp|vice president)\b.{0,70}\b(ny|ansetter|utnevnt|tiltrer|appointed|joins?|new)\b/i },
  { signalType: "Ansettelser eller kapasitetsvekst", pattern: /\b(vi søker|ledig stilling|stillinger|rekrutterer|rekruttering|karriere|careers?|jobs?|hiring|we are hiring|growing team|vekst)\b/i },
  { signalType: "Oppkjøp, fusjon eller organisasjonsendring", pattern: /\b(oppkjøp|fusjon|sammenslå|overtar|acquisition|acquire[ds]?|merger|restructur|nedbemanning|omstilling|omorganiser|organisasjonsendring)\b/i },
  { signalType: "Lansering eller strategisk digitalisering", pattern: /\b(lanser|strategi|strategisk|digitali[sz]|teknologi|automatis|kunst(ig)? intelligens|ai\b|plattform|transformation|automation|digital transformation)\b/i },
  { signalType: "Kompetanse- eller lederutvikling", pattern: /\b(kompetanse|opplæring|lederutvikling|lederskap|workforce|learning|skills?|leadership)\b/i },
];
const STANDARD_FEED_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/news/rss.xml", "/nyheter/rss.xml"];
const OFFICIAL_PAGE_PATH = /\b(news|nyheter|press|presse|media|karriere|career|careers|jobber|jobs)\b/i;

function htmlAttribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] ?? null;
}

function isSameHostname(url: string, pageUrl: string) {
  try {
    return new URL(url).hostname === new URL(pageUrl).hostname;
  } catch {
    return false;
  }
}

function classifyPublicEvent(text: string) {
  return SIGNAL_MATRIX.find((rule) => rule.pattern.test(text))?.signalType ?? null;
}

export function findOfficialFeedLink(html: string, pageUrl: string) {
  let currentPage: URL;
  try {
    currentPage = new URL(pageUrl);
  } catch {
    return null;
  }
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .flatMap((tag) => {
      const href = htmlAttribute(tag, "href");
      const type = htmlAttribute(tag, "type")?.toLowerCase();
      if (!href || !type || !/(application\/rss\+xml|application\/atom\+xml)/.test(type)) return [];
      try {
        const url = new URL(href, currentPage);
        if (url.protocol !== "https:" || url.hostname !== currentPage.hostname) return [];
        return [{ url: url.toString(), sourceType: type.includes("atom") ? "atom" as const : "rss" as const }];
      } catch {
        return [];
      }
    })
    .at(0) ?? null;
}

function isSameCandidateHostname(leftUrl: string, rightUrl: string) {
  try {
    const normalize = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");
    return normalize(new URL(leftUrl).hostname) === normalize(new URL(rightUrl).hostname);
  } catch {
    return false;
  }
}

export function historicalSnapshotDomain(fields: Record<string, string> | null | undefined) {
  if (!fields) return null;
  for (const [key, value] of Object.entries(fields)) {
    const normalizedKey = key.toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]/g, "");
    if (HISTORICAL_DOMAIN_FIELDS.has(normalizedKey)) {
      const domain = normalizeCandidateDomain(value);
      if (domain) return domain;
    }
  }
  return null;
}

async function latestHistoricalDomain(candidateId: number) {
  try {
    const snapshots = await db
      .select({ data: leadCandidateSnapshotsTable.data })
      .from(leadCandidateSnapshotsTable)
      .where(eq(leadCandidateSnapshotsTable.candidateId, candidateId))
      .orderBy(desc(leadCandidateSnapshotsTable.snapshotDate), desc(leadCandidateSnapshotsTable.importedAt))
      .limit(12);
    return snapshots.map((snapshot) => historicalSnapshotDomain(snapshot.data.fields)).find((domain): domain is string => Boolean(domain)) ?? null;
  } catch {
    return null;
  }
}

export function getOfficialPageLinks(html: string, pageUrl: string): MappingSource[] {
  return [...html.matchAll(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi)]
    .map((match) => match[0])
    .flatMap((anchor) => {
      const href = htmlAttribute(anchor, "href");
      const text = plainText(anchor);
      if (!href || !OFFICIAL_PAGE_PATH.test(`${href} ${text}`)) return [];
      try {
        const url = new URL(href, pageUrl);
        if (url.protocol !== "https:" || !isSameHostname(url.toString(), pageUrl)) return [];
        const family: PublicSourceFamily = /\b(karriere|career|jobber|jobs)\b/i.test(`${url.pathname} ${text}`) ? "careers" : "newsroom";
        return [{ url: url.toString(), label: family === "careers" ? "Offisiell karriereside" : "Offisielt presserom eller nyhetsside", family, kind: "page" as const }];
      } catch {
        return [];
      }
    });
}

type EventMappingResult = {
  outcome: "event_found" | "no_event" | "no_source" | "source_error";
  signalsCreated: number;
  sourceErrorCount: number;
  checkedSources: CheckedPublicSource[];
  message: string;
};

export function classifyEventMappingOutcome(input: {
  verifiedEventCount: number;
  successfulSourceCount: number;
  sourceErrorCount: number;
  signalsCreated: number;
}): EventMappingResult {
  if (input.verifiedEventCount > 0) {
    return {
      outcome: "event_found",
      signalsCreated: input.signalsCreated,
      sourceErrorCount: input.sourceErrorCount,
      checkedSources: [],
      message: input.signalsCreated
        ? `${input.signalsCreated} ny(e) kildebelagt(e) hendelse(r) ble lagret.`
        : "Fersk, allerede registrert hendelse ble bekreftet uten å opprette duplikat.",
    };
  }
  if (!input.successfulSourceCount) {
    return {
      outcome: "source_error",
      signalsCreated: 0,
      sourceErrorCount: input.sourceErrorCount,
      checkedSources: [],
      message: "Ingen kvalifisert kilde kunne hentes eller kontrolleres.",
    };
  }
  return {
    outcome: "no_event",
    signalsCreated: 0,
    sourceErrorCount: input.sourceErrorCount,
    checkedSources: [],
    message: "Kvalifisert offentlig kilde ble kontrollert, men ga ingen ferske hendelser som traff endringskriteriene.",
  };
}

function jsonLdStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonLdStrings);
  if (value && typeof value === "object" && "url" in value && typeof value.url === "string") return [value.url];
  return [];
}

function collectJsonLdArticles(value: unknown, pageUrl: string, events: PublicEvent[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdArticles(item, pageUrl, events));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const types = jsonLdStrings(record["@type"]).map((type) => type.toLowerCase());
  const articleLike = types.some((type) => ["article", "newsarticle", "blogposting", "jobposting"].includes(type));
  if (articleLike) {
    const title = jsonLdStrings(record.headline)[0] ?? jsonLdStrings(record.name)[0];
    const url = jsonLdStrings(record.url)[0] ?? jsonLdStrings(record.mainEntityOfPage)[0];
    const publishedAt = feedDate(jsonLdStrings(record.datePublished)[0] ?? jsonLdStrings(record.dateModified)[0] ?? "");
    const excerpt = plainText(jsonLdStrings(record.description)[0] ?? title ?? "");
    const signalType = classifyPublicEvent(`${title ?? ""} ${excerpt}`);
    if (title && url && publishedAt && signalType && isSameCandidateHostname(url, pageUrl)) {
      events.push({ title: plainText(title), url, publishedAt, excerpt: excerpt || plainText(title), signalType });
    }
  }
  Object.values(record).forEach((child) => collectJsonLdArticles(child, pageUrl, events));
}

export function parseOfficialHtmlEvents(html: string, pageUrl: string): PublicEvent[] {
  const events: PublicEvent[] = [];
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectJsonLdArticles(JSON.parse(script[1] ?? ""), pageUrl, events);
    } catch {
      // A malformed schema block is not usable evidence.
    }
  }
  for (const blockMatch of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const block = blockMatch[1] ?? "";
    const title = plainText(block.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1]);
    const href = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    const publishedAt = feedDate(block.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ?? "");
    const excerpt = plainText(block).slice(0, 900);
    const signalType = classifyPublicEvent(`${title} ${excerpt}`);
    if (!title || !href || !publishedAt || !signalType) continue;
    try {
      const url = new URL(href, pageUrl).toString();
      if (isSameCandidateHostname(url, pageUrl)) events.push({ title, url, publishedAt, excerpt, signalType });
    } catch {
      // Relative or malformed URLs that cannot be resolved are not evidence.
    }
  }
  return [...new Map(events.map((event) => [event.url, event])).values()];
}

export async function discoverMappingSources(candidate: Candidate, registeredSources: CandidateSource[], historicalDomain?: string | null) {
  const sources: MappingSource[] = registeredSources.map((source) => ({
    url: source.url,
    label: source.label,
    family: "registered_feed",
    kind: "feed",
    registeredSourceId: source.id,
  }));
  const domain = normalizeCandidateDomain(candidate.domain) ?? normalizeCandidateDomain(historicalDomain);
  if (domain) {
    try {
      const homepageUrl = new URL(`https://${domain}`);
      try {
        const response = await fetchTextWithTimeout(homepageUrl.toString());
        const html = await response.text();
        const pageUrl = response.url;
        if (isSameCandidateHostname(pageUrl, homepageUrl.toString())) {
          const linkedFeed = findOfficialFeedLink(html, pageUrl);
          if (linkedFeed) sources.push({ ...linkedFeed, label: "Offisiell feed oppdaget på hjemmesiden", family: "standard_feed", kind: "feed" });
          for (const path of STANDARD_FEED_PATHS) {
            sources.push({ url: new URL(path, pageUrl).toString(), label: "Standard RSS-/Atom-adresse", family: "standard_feed", kind: "feed" });
          }
          sources.push(...getOfficialPageLinks(html, pageUrl).slice(0, 4));
        }
      } catch {
        // A missing or unavailable homepage is reported only when no other source succeeds.
      }
    } catch {
      // An invalid imported domain does not prevent an organization-number lookup.
    }
  }
  if (candidate.organizationNumber?.replace(/\D/g, "").length === 9) {
    sources.push({
      url: `https://data.brreg.no/enhetsregisteret/api/enheter/${candidate.organizationNumber.replace(/\D/g, "")}`,
      label: "Brønnøysundregistrene",
      family: "brreg",
      kind: "brreg",
    });
  }
  return [...new Map(sources.map((source) => [source.url, source])).values()];
}

export function isMissingStandardFeed(error: unknown, source: Pick<MappingSource, "family">) {
  return source.family === "standard_feed" && error instanceof Error && /HTTP (?:404|410)$/.test(error.message);
}

function brregRecentEvent(payload: unknown, sourceUrl: string): PublicEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const dateValue = ["endringsdato", "datoSistEndret", "sistEndret"]
    .flatMap((key) => jsonLdStrings(record[key]))
    .find(Boolean);
  const publishedAt = feedDate(dateValue ?? "");
  if (!publishedAt) return null;
  const name = jsonLdStrings(record.navn)[0] ?? "Virksomheten";
  return {
    title: `${name}: offentlig registrert selskapsendring`,
    url: sourceUrl,
    publishedAt,
    excerpt: `Brønnøysundregistrene oppgir en offentlig endringsdato ${publishedAt}. Endringens art må vurderes før oppfølging.`,
    signalType: "Offentlig registrert selskapsendring",
  };
}

async function saveMappedPublicEvent(candidate: Candidate, runId: number, event: PublicEvent, source: MappingSource) {
  await verifyPublicUrl(event.url);
  const signalKey = createHash("sha256").update(`${candidate.id}|${event.url}`).digest("hex");
  const excerpt = plainText(event.excerpt).slice(0, 900);
  const [inserted] = await db.insert(signalpilotSignalsTable).values({
    companyName: candidate.companyName,
    employees: candidate.employees ?? 0,
    industry: candidate.industry ?? "Ikke oppgitt",
    domain: candidate.domain ?? "",
    signalType: event.signalType,
    strength: "C",
    status: "til_vurdering",
    summary: excerpt,
    rationale: "Engangskartleggingen fant en fersk offentlig hendelse. Kandidaten er ikke lagt til i løpende overvåkning.",
    publishedAt: event.publishedAt,
    evidence: [{
      title: event.title,
      url: event.url,
      sourceType: `${source.family}: ${source.label}`,
      publishedAt: event.publishedAt,
      excerpt,
      verificationStatus: "url_verified",
      verifiedAt: new Date().toISOString(),
    }],
    contacts: [{
      id: -1,
      name: "CRM ikke hentet",
      title: "Kartlegging uten CRM-oppslag",
      confidence: "ikke_verifisert",
      rationale: "Engangskartleggingen leser ikke CRM.",
    }],
    crm: { status: "Ikke hentet i engangskartlegging", matchCount: 0 },
    suggestedOpening: "En fersk, offentlig hendelse er registrert. Vurder relevans og riktig kontaktrolle før eventuell oppfølging.",
    dialogueDraft: "Ingen melding er foreslått. Kartleggingen er kun et kildegrunnlag.",
    candidateId: candidate.id,
    monitoringRunId: runId,
    signalKey,
    actionPriority: candidate.priorityScore,
    isActionable: false,
  }).onConflictDoNothing({ target: signalpilotSignalsTable.signalKey }).returning({ id: signalpilotSignalsTable.id });
  if (!inserted) return false;
  await db.insert(leadCandidateEvidenceTable).values({
    candidateId: candidate.id,
    title: event.title,
    url: event.url,
    sourceType: `${source.family}: ${source.label}`,
    publishedAt: event.publishedAt,
    excerpt,
    verificationStatus: "url_verified",
  }).onConflictDoNothing();
  return true;
}

async function collectEventMappingSignals(candidate: Candidate, runId: number): Promise<EventMappingResult> {
  const registeredSources = await db.select().from(leadCandidateSourcesTable).where(and(
    eq(leadCandidateSourcesTable.candidateId, candidate.id),
    eq(leadCandidateSourcesTable.isActive, "true"),
  ));
  const historicalDomain = candidate.domain ? null : await latestHistoricalDomain(candidate.id);
  const sources = await discoverMappingSources(candidate, registeredSources, historicalDomain);
  if (!sources.length) {
    return {
      outcome: "no_source",
      signalsCreated: 0,
      sourceErrorCount: 0,
      checkedSources: [],
      message: "Ingen kvalifisert offentlig kilde kunne avledes fra kandidatens domene eller organisasjonsnummer.",
    };
  }

  let signalsCreated = 0;
  let sourceErrorCount = 0;
  let verifiedEventCount = 0;
  let successfulSourceCount = 0;
  const checkedSources: CheckedPublicSource[] = [];

  const processSource = async (source: MappingSource) => {
    try {
      const response = await fetchTextWithTimeout(source.url, "GET", false, source.kind === "brreg" ? "application/json" : undefined);
      if (source.family !== "brreg" && !isSameCandidateHostname(response.url, source.url)) {
        throw new Error("Kilden omdirigerte utenfor kandidatens domene.");
      }
      const body = await response.text();
      const isFeedDocument = /<(?:rss|feed)\b/i.test(body);
      const events = source.kind === "feed"
        ? parseFeed(body).flatMap((entry) => {
          if (!isSameCandidateHostname(entry.url, response.url)) return [];
          const signalType = classifyPublicEvent(`${entry.title} ${entry.excerpt}`);
          return signalType ? [{ ...entry, signalType }] : [];
        })
        : source.kind === "page"
          ? parseOfficialHtmlEvents(body, response.url)
          : [brregRecentEvent(JSON.parse(body), source.url)].filter((event): event is PublicEvent => Boolean(event));
      if (source.kind === "feed" && !isFeedDocument) {
        if (source.family === "standard_feed") return;
      }
      successfulSourceCount += 1;
      checkedSources.push({ url: source.url, label: source.label, family: source.family, status: "checked", detail: events.length ? `${events.length} ferske signalmulighet(er)` : "Kontrollert uten fersk signalmulighet" });
      for (const event of events) {
        try {
          if (await saveMappedPublicEvent(candidate, runId, event, source)) signalsCreated += 1;
          verifiedEventCount += 1;
        } catch {
          sourceErrorCount += 1;
        }
      }
      if (source.registeredSourceId) await db.update(leadCandidateSourcesTable).set({ lastCheckedAt: new Date(), lastError: null }).where(eq(leadCandidateSourcesTable.id, source.registeredSourceId));
    } catch (error) {
      if (isMissingStandardFeed(error, source)) return;
      sourceErrorCount += 1;
      checkedSources.push({ url: source.url, label: source.label, family: source.family, status: "error", detail: error instanceof Error ? error.message.slice(0, 180) : "Ukjent kildefeil" });
      if (source.registeredSourceId) await db.update(leadCandidateSourcesTable).set({
        lastCheckedAt: new Date(),
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Ukjent kildefeil",
      }).where(eq(leadCandidateSourcesTable.id, source.registeredSourceId));
    }
  };
  let nextSourceIndex = 0;
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, async () => {
    while (nextSourceIndex < sources.length) {
      const source = sources[nextSourceIndex];
      nextSourceIndex += 1;
      await processSource(source);
    }
  }));

  if (!successfulSourceCount && !sourceErrorCount) {
    return {
      outcome: "no_source",
      signalsCreated: 0,
      sourceErrorCount: 0,
      checkedSources,
      message: "Ingen RSS-/Atom-feed, presserom, nyhetsside, karriereside eller registerkilde kunne dokumenteres.",
    };
  }
  const result = classifyEventMappingOutcome({
    verifiedEventCount,
    successfulSourceCount,
    sourceErrorCount,
    signalsCreated,
  });
  return {
    ...result,
    checkedSources,
    message: result.message,
  };
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

export async function runMonitoringScan(trigger: "manual" | "scheduled", candidateIds?: number[]) {
  await expireStaleRunLocks();
  const [activeRun] = await db.select().from(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.status, "running")).orderBy(desc(leadMonitoringRunsTable.startedAt));
  if (activeRun) throw new MonitoringRunInProgressError("En overvåkningskjøring pågår allerede.");

  const candidateFilter = candidateIds === undefined
    ? eq(leadCandidatesTable.monitoringStatus, "monitoring")
    : and(
      eq(leadCandidatesTable.monitoringStatus, "monitoring"),
      inArray(leadCandidatesTable.id, candidateIds),
    );
  const candidates = await db.select().from(leadCandidatesTable).where(candidateFilter).orderBy(desc(leadCandidatesTable.priorityScore));
  const [run] = await db.insert(leadMonitoringRunsTable).values({
    status: "running",
    trigger,
    kind: "monitoring",
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

export async function runEventMappingScan() {
  await expireStaleRunLocks();
  const [activeRun] = await db.select().from(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.status, "running")).orderBy(desc(leadMonitoringRunsTable.startedAt));
  if (activeRun) throw new MonitoringRunInProgressError("En annen offentlig kildekjøring pågår allerede.");

  const candidates = await db.select().from(leadCandidatesTable)
    .where(eq(leadCandidatesTable.relevanceStatus, "possible"))
    .orderBy(desc(leadCandidatesTable.priorityScore));
  const [run] = await db.insert(leadMonitoringRunsTable).values({
    status: "running",
    trigger: "manual",
    kind: "event_mapping",
    requestedCount: candidates.length,
  }).returning();

  let processedCount = 0;
  let signalsCreated = 0;
  let sourceErrorCount = 0;
  const failures: string[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(3, candidates.length);

  const processCandidate = async (candidate: Candidate) => {
    try {
      const result = await collectEventMappingSignals(candidate, run.id);
      processedCount += 1;
      signalsCreated += result.signalsCreated;
      sourceErrorCount += result.sourceErrorCount;
      await db.insert(leadMonitoringRunItemsTable).values({
        runId: run.id,
        candidateId: candidate.id,
        status: "processed",
        brregStatus: "not_requested",
        crmStatus: "not_requested",
        signalsCreated: result.signalsCreated,
        sourceErrorCount: result.sourceErrorCount,
        outcome: result.outcome,
        checkedSources: result.checkedSources,
        message: result.message,
      });
    } catch (error) {
      const message = `${candidate.companyName}: ${error instanceof Error ? error.message : "ukjent feil"}`;
      failures.push(message);
      await db.insert(leadMonitoringRunItemsTable).values({
        runId: run.id,
        candidateId: candidate.id,
        status: "failed",
        brregStatus: "not_requested",
        crmStatus: "not_requested",
        signalsCreated: 0,
        sourceErrorCount: 0,
        outcome: "source_error",
        checkedSources: [],
        message: message.slice(0, 1_000),
      });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex];
      nextIndex += 1;
      await processCandidate(candidate);
    }
  }));

  const [completed] = await db.update(leadMonitoringRunsTable).set({
    status: failures.length || sourceErrorCount ? "completed_with_errors" : "completed",
    processedCount,
    signalsCreated,
    crmMatchedCount: 0,
    crmUnresolvedCount: 0,
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
  const [run] = await db.select().from(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.kind, "monitoring")).orderBy(desc(leadMonitoringRunsTable.startedAt)).limit(1);
  if (!run) {
    res.status(404).json({ error: "Ingen overvåkningskjøring er registrert ennå." });
    return;
  }
  res.json(GetLatestMonitoringRunResponse.parse(monitoringRunResponse(run)));
});

router.post("/monitoring/runs", async (req, res): Promise<void> => {
  const body = StartMonitoringRunBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Kandidat-ID-ene for kjøringen er ugyldige." });
    return;
  }
  if (activeMonitoringJob) {
    res.status(409).json({ error: "En overvåkningskjøring pågår allerede." });
    return;
  }
  const job = runMonitoringScan("manual", body.data.candidateIds);
  activeMonitoringJob = job;
  void job.catch(() => undefined).finally(() => {
    activeMonitoringJob = null;
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [run] = await db.select().from(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.kind, "monitoring")).orderBy(desc(leadMonitoringRunsTable.startedAt)).limit(1);
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

router.get("/event-mapping/runs/latest", async (_req, res): Promise<void> => {
  const [run] = await db.select().from(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.kind, "event_mapping")).orderBy(desc(leadMonitoringRunsTable.startedAt)).limit(1);
  if (!run) {
    res.status(404).json({ error: "Ingen kartlegging av nylige hendelser er registrert ennå." });
    return;
  }
  res.json(GetLatestEventMappingRunResponse.parse(monitoringRunResponse(run)));
});

router.post("/event-mapping/runs", async (_req, res): Promise<void> => {
  if (activeEventMappingJob) {
    res.status(409).json({ error: "En kartlegging av nylige hendelser pågår allerede." });
    return;
  }
  const job = runEventMappingScan();
  activeEventMappingJob = job;
  void job.catch(() => undefined).finally(() => {
    activeEventMappingJob = null;
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const [run] = await db.select().from(leadMonitoringRunsTable).where(and(
      eq(leadMonitoringRunsTable.kind, "event_mapping"),
      eq(leadMonitoringRunsTable.status, "running"),
    )).orderBy(desc(leadMonitoringRunsTable.startedAt)).limit(1);
    if (run) {
      res.json(StartEventMappingRunResponse.parse(monitoringRunResponse(run)));
      return;
    }
  }
  try {
    const run = await job;
    res.json(StartEventMappingRunResponse.parse(monitoringRunResponse(run)));
  } catch (error) {
    if (error instanceof MonitoringRunInProgressError) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: error instanceof Error ? error.message : "Kartleggingen feilet." });
    }
  }
});

router.get("/event-mapping/runs/:id/items", async (req, res): Promise<void> => {
  const params = ListEventMappingItemsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Ugyldig kjørings-ID." });
    return;
  }
  const [run] = await db.select().from(leadMonitoringRunsTable).where(and(
    eq(leadMonitoringRunsTable.id, params.data.id),
    eq(leadMonitoringRunsTable.kind, "event_mapping"),
  ));
  if (!run) {
    res.status(404).json({ error: "Kartleggingen finnes ikke." });
    return;
  }
  const items = await db.select().from(leadMonitoringRunItemsTable).where(eq(leadMonitoringRunItemsTable.runId, run.id));
  if (!items.length) {
    res.json(ListEventMappingItemsResponse.parse([]));
    return;
  }
  const candidates = await db.select({
    id: leadCandidatesTable.id,
    companyName: leadCandidatesTable.companyName,
  }).from(leadCandidatesTable).where(inArray(leadCandidatesTable.id, items.map((item) => item.candidateId)));
  const names = new Map(candidates.map((candidate) => [candidate.id, candidate.companyName]));
  res.json(ListEventMappingItemsResponse.parse(items.map((item) => ({
    candidateId: item.candidateId,
    candidateName: names.get(item.candidateId) ?? "Ukjent kandidat",
    outcome: item.outcome ?? "source_error",
    signalsCreated: item.signalsCreated,
    sourceErrorCount: item.sourceErrorCount,
    checkedSources: item.checkedSources,
    message: item.message,
  }))));
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