import assert from "node:assert/strict";
import test from "node:test";
import { classifyEventMappingOutcome, findOfficialFeedLink } from "./monitoring";

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