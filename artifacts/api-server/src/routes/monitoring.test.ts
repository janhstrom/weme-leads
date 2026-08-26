import assert from "node:assert/strict";
import test from "node:test";
import { classifyEventMappingOutcome, discoverMappingSources, findOfficialFeedLink, getOfficialPageLinks, parseOfficialHtmlEvents } from "./monitoring";

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