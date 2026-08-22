import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRemoveLegacyPilotSignal, verifyPublicEvidence } from "./signalpilot";

const validEvidence = {
  title: "En verifisert selskapsnyhet",
  url: "https://example.com/news",
  sourceType: "Selskapsnyhet",
  publishedAt: "2026-01-15",
  excerpt: "Dette er et tilstrekkelig langt sitat fra den offentlige kilden.",
};

test("legacy pilot sources are removable only for their known pilot company", () => {
  assert.equal(
    shouldRemoveLegacyPilotSignal({
      companyName: "Motek",
      evidence: [{ ...validEvidence, url: "https://www.motek.no/nyheter/" }],
    } as never),
    true,
  );
  assert.equal(
    shouldRemoveLegacyPilotSignal({
      companyName: "Unrelated import",
      evidence: [{ ...validEvidence, url: "https://www.motek.no/nyheter/" }],
    } as never),
    false,
  );
});

test("concrete pilot sources are retained only after URL validation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    const verified = await verifyPublicEvidence(validEvidence);
    assert.equal(verified.verificationStatus, "url_verified");
    await assert.rejects(
      verifyPublicEvidence({ ...validEvidence, url: "http://example.com/news" }),
      /HTTPS/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unresponsive source is aborted and rejected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  try {
    await assert.rejects(verifyPublicEvidence(validEvidence), /seks sekunder/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});