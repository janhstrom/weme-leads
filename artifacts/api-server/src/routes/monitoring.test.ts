import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before } from "node:test";
import test from "node:test";
import { db, leadCandidateSourcesTable, leadCandidatesTable, leadMonitoringRunsTable, signalpilotSignalsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { classifyEventMappingOutcome, discoverMappingSources, findOfficialFeedLink, getOfficialPageLinks, historicalSnapshotDomain, isMissingStandardFeed, parseOfficialHtmlEvents } from "./monitoring";

const testRun = `monitoring-api-${Date.now()}`;
const companyName = `Ekte API overvåkning ${testRun}`;
const feedUrl = `https://monitoring-test.example/${testRun}/feed.xml`;
const articleUrl = `https://monitoring-test.example/${testRun}/digital-endring`;
const publishedAt = new Date().toISOString().slice(0, 10);

let server: Server;
let baseUrl: string;
let candidateId: number;
let monitoringRunId: number | null = null;
let originalFetch: typeof fetch;
let existingMonitoringCandidateIds: number[] = [];

async function request(path: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await originalFetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return { response, body: await response.json() };
}

before(async () => {
  const existingMonitoringCandidates = await db
    .select({ id: leadCandidatesTable.id })
    .from(leadCandidatesTable)
    .where(eq(leadCandidatesTable.monitoringStatus, "monitoring"));
  existingMonitoringCandidateIds = existingMonitoringCandidates.map((candidate) => candidate.id);
  if (existingMonitoringCandidateIds.length > 0) {
    await db.update(leadCandidatesTable)
      .set({ monitoringStatus: "not_monitoring" })
      .where(inArray(leadCandidatesTable.id, existingMonitoringCandidateIds));
  }

  const [candidate] = await db.insert(leadCandidatesTable).values({
    companyName: companyName,
    normalizedName: companyName.toLowerCase(),
    domain: "monitoring-test.example",
    matchStatus: "exact",
    relevanceStatus: "relevant",
    relevanceReason: "Kontrollert kandidat for API-integrasjonstest",
    relevanceSource: "system",
    monitoringStatus: "monitoring",
    priorityScore: 40,
    priorityReasons: ["API-integrasjonstest"],
  }).returning({ id: leadCandidatesTable.id });
  candidateId = candidate!.id;

  await db.insert(leadCandidateSourcesTable).values({
    candidateId,
    sourceType: "rss",
    url: feedUrl,
    label: "Kontrollert testfeed",
  });

  originalFetch = globalThis.fetch;
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
  await db.delete(signalpilotSignalsTable).where(eq(signalpilotSignalsTable.candidateId, candidateId));
  await db.delete(leadCandidatesTable).where(eq(leadCandidatesTable.id, candidateId));
  if (monitoringRunId !== null) {
    await db.delete(leadMonitoringRunsTable).where(eq(leadMonitoringRunsTable.id, monitoringRunId));
  }
  if (existingMonitoringCandidateIds.length > 0) {
    await db.update(leadCandidatesTable)
      .set({ monitoringStatus: "monitoring" })
      .where(inArray(leadCandidatesTable.id, existingMonitoringCandidateIds));
  }
});

async function withControlledSources<T>(action: () => Promise<T>) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === feedUrl) {
      return Promise.resolve(new Response(`
        <rss version="2.0">
          <channel>
            <item>
              <title>Ny digital strategi for arbeidshverdagen</title>
              <link>${articleUrl}</link>
              <pubDate>${new Date(`${publishedAt}T09:00:00.000Z`).toUTCString()}</pubDate>
              <description>Selskapet lanserer en ny digital arbeidsplattform.</description>
            </item>
          </channel>
        </rss>
      `, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }));
    }
    if (url === articleUrl) {
      assert.equal(init?.method, "HEAD");
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    return originalFetch(url, init);
  }) as typeof fetch;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function waitForCompletedMonitoringRun() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const latest = await request("/monitoring/runs/latest");
    assert.equal(latest.response.status, 200);
    if (latest.body.status !== "running") return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Overvåkningskjøringen ble ikke fullført innen tidsgrensen.");
}

test("lagrer en ekte API-kjøring og returnerer oppdaterte køtall", async () => {
  const beforeActions = await request("/monitoring/actions");
  assert.equal(beforeActions.response.status, 200);
  assert.equal(
    beforeActions.body.some((action: { company: { name: string } }) => action.company.name === companyName),
    false,
  );

  const result = await withControlledSources(async () => {
    const started = await request("/monitoring/runs", { method: "POST" });
    assert.equal(started.response.status, 200);
    assert.equal(started.body.kind, "monitoring");
    assert.equal(started.body.trigger, "manual");
    assert.equal(typeof started.body.id, "number");
    monitoringRunId = started.body.id;

    const latest = await waitForCompletedMonitoringRun();
    const actions = await request("/monitoring/actions");
    return { latest, actions };
  });

  assert.equal(result.latest.body.id, monitoringRunId);
  assert.equal(result.latest.body.status, "completed");
  assert.equal(result.latest.body.requestedCount, 1);
  assert.equal(result.latest.body.processedCount, 1);
  assert.equal(result.latest.body.signalsCreated, 1);
  assert.equal(result.latest.body.crmMatchedCount, 0);
  assert.equal(result.latest.body.crmUnresolvedCount, 1);
  assert.equal(result.latest.body.sourceErrorCount, 0);
  assert.equal(result.actions.response.status, 200);

  const createdAction = result.actions.body.find(
    (action: { company: { name: string } }) => action.company.name === companyName,
  );
  assert.ok(createdAction);
  assert.equal(createdAction.summary, "Selskapet lanserer en ny digital arbeidsplattform.");
  assert.equal(createdAction.evidence[0].url, articleUrl);
});

test("finner bare en HTTPS RSS- eller Atom-feed fra kandidatens eget domene", () => {
  assert.deepEqual(
    findOfficialFeedLink('<link rel="alternate" type="application/rss+xml" href="/news/feed.xml">', "https://example.no/"),
    { url: "https://example.no/news/feed.xml", sourceType: "rss" },
  );
  assert.equal(
    findOfficialFeedLink('<link rel="alternate" type="application/atom+xml" href="https://other.example/feed.xml">', "https://example.no/"),
    null,
  );
  assert.equal(
    findOfficialFeedLink('<link rel="alternate" type="text/html" href="/news">', "https://example.no/"),
    null,
  );
});

test("godtar kandidatens www-alias, men avviser andre publiseringsdomener", () => {
  const today = new Date().toISOString().slice(0, 10);
  const ownDomainHtml = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    headline: "Selskapet lanserer ny digital plattform",
    url: "https://www.example.no/nyheter/plattform",
    datePublished: today,
  })}</script>`;
  const externalDomainHtml = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    headline: "Selskapet lanserer ny digital plattform",
    url: "https://publisher.example/nyheter/plattform",
    datePublished: today,
  })}</script>`;
  assert.equal(parseOfficialHtmlEvents(ownDomainHtml, "https://example.no/nyheter").length, 1);
  assert.equal(parseOfficialHtmlEvents(externalDomainHtml, "https://example.no/nyheter").length, 0);
});

test("beholder Brønnøysund som kilde når kandidaten mangler domene", async () => {
  const sources = await discoverMappingSources({
    organizationNumber: "912 345 678",
    domain: null,
  } as never, []);
  assert.deepEqual(sources, [{
    url: "https://data.brreg.no/enhetsregisteret/api/enheter/912345678",
    label: "Brønnøysundregistrene",
    family: "brreg",
    kind: "brreg",
  }]);
});

test("henter kandidatens domene fra godkjente felter i historiske snapshots", () => {
  assert.equal(historicalSnapshotDomain({ "Company Domain Name": "https://www.Akerbp.com/no/" }), "akerbp.com");
  assert.equal(historicalSnapshotDomain({ "Company Website": "www.example.no" }), "example.no");
  assert.equal(historicalSnapshotDomain({ "Company Linkedin ID URL": "https://linkedin.example/company" }), null);
});

test("behandler permanent manglende standardfeed som manglende kilde, ikke kildefeil", () => {
  assert.equal(isMissingStandardFeed(new Error("HTTP 404"), { family: "standard_feed" }), true);
  assert.equal(isMissingStandardFeed(new Error("HTTP 410"), { family: "standard_feed" }), true);
  assert.equal(isMissingStandardFeed(new Error("HTTP 500"), { family: "standard_feed" }), false);
  assert.equal(isMissingStandardFeed(new Error("HTTP 410"), { family: "newsroom" }), false);
});

test("skiller hendelse, manglende kilde og kildefeil i kartleggingen", () => {
  assert.equal(classifyEventMappingOutcome({
    verifiedEventCount: 1,
    successfulSourceCount: 1,
    sourceErrorCount: 0,
    signalsCreated: 1,
  }).outcome, "event_found");
  assert.equal(classifyEventMappingOutcome({
    verifiedEventCount: 0,
    successfulSourceCount: 1,
    sourceErrorCount: 0,
    signalsCreated: 0,
  }).outcome, "no_event");
  assert.equal(classifyEventMappingOutcome({
    verifiedEventCount: 0,
    successfulSourceCount: 0,
    sourceErrorCount: 1,
    signalsCreated: 0,
  }).outcome, "source_error");
});

test("oppdager bare offisielle presserom- og karrieresider på kandidatens eget domene", () => {
  const links = getOfficialPageLinks(`
    <a href="/nyheter">Nyheter</a>
    <a href="https://example.no/karriere">Karriere</a>
    <a href="https://other.example/news">Ekstern nyhet</a>
  `, "https://example.no/");
  assert.deepEqual(links.map((link) => ({ url: link.url, family: link.family })), [
    { url: "https://example.no/nyheter", family: "newsroom" },
    { url: "https://example.no/karriere", family: "careers" },
  ]);
});

test("henter bare daterte, relevante JSON-LD-artikler fra samme domene", () => {
  const today = new Date().toISOString().slice(0, 10);
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: "Selskapet lanserer ny digital plattform",
    url: "https://example.no/nyheter/plattform",
    datePublished: today,
    description: "En strategisk digitalisering av tjenestene.",
  })}</script>
  <script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    headline: "Ekstern oppkjøpsnyhet",
    url: "https://other.example/news",
    datePublished: today,
  })}</script>`;
  assert.deepEqual(parseOfficialHtmlEvents(html, "https://example.no/nyheter"), [{
    title: "Selskapet lanserer ny digital plattform",
    url: "https://example.no/nyheter/plattform",
    publishedAt: today,
    excerpt: "En strategisk digitalisering av tjenestene.",
    signalType: "Lansering eller strategisk digitalisering",
  }]);
});