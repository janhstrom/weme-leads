import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichCandidateFromCrm,
  findSafeCrmCompanyMatch,
} from "./candidate-crm.ts";

test("prioriterer unikt organisasjonsnummer før domene og navn", () => {
  const match = findSafeCrmCompanyMatch(
    { companyName: "Nord AS", organizationNumber: " 912 345 678 ", domain: "nord.no" },
    [
      { company_name: "Nord AS", organization_number: "912345678", website: "other.example" },
      { company_name: "Nord AS", website: "nord.no" },
    ],
  );

  assert.equal(match.status, "matched");
  assert.equal(match.matchMethod, "organization_number");
  assert.equal(match.company?.website, "other.example");
});

test("lar tvetydige CRM-navnetreff være uavklart", () => {
  const match = findSafeCrmCompanyMatch(
    { companyName: "Likhet AS", organizationNumber: null, domain: null },
    [{ company_name: "Likhet AS" }, { company_name: "Likhet AS" }],
  );

  assert.equal(match.status, "ambiguous");
  assert.equal(match.company, null);
});

test("matcher CRM-poster som lagrer selskapsdomenet i company-feltet", () => {
  const match = findSafeCrmCompanyMatch(
    { companyName: "Vipps MobilePay AS", organizationNumber: null, domain: "www.vippsmobilepay.com" },
    [{ company_name: "vippsmobilepay.com" }],
  );

  assert.equal(match.status, "matched");
  assert.equal(match.matchMethod, "domain");
  assert.equal(match.company?.company_name, "vippsmobilepay.com");
});

test("bruker domene eller kort selskapsord når CRM ikke finner fullt juridisk navn", async () => {
  const searches: string[] = [];
  const fetchImpl = async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const search = url.searchParams.get("search") ?? "";
    searches.push(search);
    const body = search === "vippsmobilepay.com" || search === "vipps"
      ? { contacts: [{ id: 77, company: "vippsmobilepay.com", website: null }] }
      : { contacts: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  };

  const result = await enrichCandidateFromCrm(
    { companyName: "Vipps MobilePay AS", organizationNumber: null, domain: "vippsmobilepay.com" },
    { apiKey: "test-key", baseUrl: "https://crm.example/agent", fetchImpl: fetchImpl as typeof fetch },
  );

  assert.equal(result.status, "matched");
  assert.equal(result.matchMethod, "domain");
  assert.equal(result.matchedDomain, "vippsmobilepay.com");
  assert.deepEqual(searches.slice(0, 2), ["Vipps MobilePay AS", "vippsmobilepay.com"]);
});

test("samler et sikkert CRM-treff uten å skrive tilbake til CRM", async () => {
  const requests: Array<{ url: string; method: string | undefined }> = [];
  const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    requests.push({ url, method: init?.method });
    const body = url.includes("/agent/contacts?")
      ? {
          contacts: [
            {
              id: 44,
              first_name: "Ada",
              last_name: "Leder",
              company: "Nord AS",
              website: "https://nord.no",
              job_title: "Head of Digital Transformation",
              owner: "WeMe",
              lifecycle_stage: "Opportunity",
              lead_status: "Open",
              updated_at: "2026-08-20T09:00:00.000Z",
              custom_properties: { orgnr: "912345678" },
            },
            { id: 45, first_name: "Per", last_name: "Prosjekt", company: "Nord AS", website: "https://nord.no" },
          ],
        }
      : { notes: [{ created_at: "2026-08-22T09:00:00.000Z" }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await enrichCandidateFromCrm(
    { companyName: "Nord AS", organizationNumber: "912345678", domain: "nord.no" },
    { apiKey: "test-key", baseUrl: "https://crm.example/agent", fetchImpl: fetchImpl as typeof fetch },
  );

  assert.equal(result.status, "matched");
  assert.equal(result.matchMethod, "organization_number");
  assert.equal(result.contactCount, 2);
  assert.equal(result.relevantContacts[0]?.name, "Ada Leder");
  assert.deepEqual(result.lifecycleStages, ["Opportunity"]);
  assert.equal(result.noteCount, 2);
  assert.equal(result.lastActivityAt, "2026-08-22T09:00:00.000Z");
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.method === undefined));
});

test("beholder kandidaten når CRM svarer med rate-limit", async () => {
  const result = await enrichCandidateFromCrm(
    { companyName: "Vent AS", organizationNumber: null, domain: null },
    {
      apiKey: "test-key",
      baseUrl: "https://crm.example/agent",
      fetchImpl: async () => new Response("", { status: 429 }),
    },
  );

  assert.equal(result.status, "unavailable");
  assert.match(result.availabilityMessage ?? "", /begrenset/i);
});