import {
  normalizeCandidateDomain,
  normalizeCandidateName,
} from "./candidate-matching";
import type {
  CandidateCrmContact,
  CandidateCrmEnrichment,
  CandidateCrmEnrichmentStatus,
  CandidateCrmMatchMethod,
} from "@workspace/db";

export type { CandidateCrmContact, CandidateCrmEnrichment, CandidateCrmEnrichmentStatus, CandidateCrmMatchMethod };

type CrmCompanyPayload = {
  company_name?: unknown;
  companyName?: unknown;
  name?: unknown;
  website?: unknown;
  domain?: unknown;
  industry?: unknown;
  organization_number?: unknown;
  organizationNumber?: unknown;
  orgnr?: unknown;
  custom_properties?: unknown;
};

type CrmContactPayload = {
  id?: unknown;
  company?: unknown;
  company_name?: unknown;
  website?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  name?: unknown;
  full_name?: unknown;
  job_title?: unknown;
  title?: unknown;
  email?: unknown;
  owner?: unknown;
  lifecycle_stage?: unknown;
  lifecycleStage?: unknown;
  lead_status?: unknown;
  leadStatus?: unknown;
  contact_role?: unknown;
  contactRole?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  custom_properties?: unknown;
};

export type CrmCandidateInput = {
  companyName: string;
  organizationNumber: string | null;
  domain: string | null;
};

class CrmRequestError extends Error {
  constructor(
    readonly kind: "configuration" | "timeout" | "rate_limit" | "upstream",
    message: string,
  ) {
    super(message);
  }
}

const CRM_TIMEOUT_MS = 6_000;
const relevantRolePattern = /\b(hr|human resources|people|transform|endring|change|digital|ai|strategi|strategy|program|learning|kompetanse|leder|leadership)\b/i;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function companyContacts(payload: CrmContactPayload[], company: CrmCompanyPayload) {
  const companyNameValue = companyName(company);
  if (!companyNameValue) return [];
  const normalized = normalizeCandidateName(companyNameValue);
  return payload.filter((contact) => {
    const contactCompany = stringValue(contact.company) ?? stringValue(contact.company_name);
    return contactCompany ? normalizeCandidateName(contactCompany) === normalized : false;
  });
}

function companiesFromContacts(contacts: CrmContactPayload[]): CrmCompanyPayload[] {
  const companies = new Map<string, CrmCompanyPayload>();
  for (const contact of contacts) {
    const name = stringValue(contact.company) ?? stringValue(contact.company_name);
    if (!name) continue;
    const website = stringValue(contact.website);
    const organizationNumber = contact.custom_properties && typeof contact.custom_properties === "object"
      ? contact.custom_properties
      : undefined;
    const company = {
      company_name: name,
      website,
      custom_properties: organizationNumber,
    } satisfies CrmCompanyPayload;
    const key = [normalizeCandidateName(name), companyDomain(company) ?? ""].join("|");
    const existing = companies.get(key);
    if (!existing || (!companyOrganizationNumber(existing) && companyOrganizationNumber(company))) {
      companies.set(key, company);
    }
  }
  return [...companies.values()];
}

function contactList(payload: unknown): CrmContactPayload[] {
  if (Array.isArray(payload)) return payload as CrmContactPayload[];
  if (!payload || typeof payload !== "object") return [];
  const wrapped = payload as { contacts?: unknown; results?: unknown; data?: unknown };
  for (const item of [wrapped.contacts, wrapped.results, wrapped.data]) {
    if (Array.isArray(item)) return item as CrmContactPayload[];
  }
  return [];
}

function noteList(payload: unknown): Array<{ createdAt: string | null }> {
  const values = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? [((payload as { notes?: unknown }).notes), ((payload as { data?: unknown }).data), ((payload as { results?: unknown }).results)]
        .find(Array.isArray) ?? []
      : [];
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    const item = value && typeof value === "object" ? value as { created_at?: unknown; createdAt?: unknown; updated_at?: unknown; updatedAt?: unknown } : {};
    return {
      createdAt: stringValue(item.created_at) ?? stringValue(item.createdAt) ?? stringValue(item.updated_at) ?? stringValue(item.updatedAt),
    };
  });
}

function companyName(company: CrmCompanyPayload) {
  return stringValue(company.company_name) ?? stringValue(company.companyName) ?? stringValue(company.name);
}

function companyDomain(company: CrmCompanyPayload) {
  const explicitDomain = stringValue(company.website) ?? stringValue(company.domain);
  if (explicitDomain) return normalizeCandidateDomain(explicitDomain);

  // The CRM contract models a company as the contact's string `company` field.
  // Some imported records store the company domain there instead of in
  // `website`/`domain` (for example, `vippsmobilepay.com`).
  const value = companyName(company);
  return value && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)
    ? normalizeCandidateDomain(value)
    : null;
}

function companyOrganizationNumber(company: CrmCompanyPayload) {
  const direct = stringValue(company.organization_number) ?? stringValue(company.organizationNumber) ?? stringValue(company.orgnr);
  if (direct) return direct.replace(/\s/g, "");
  if (!company.custom_properties || typeof company.custom_properties !== "object") return null;
  const properties = company.custom_properties as Record<string, unknown>;
  for (const key of ["orgnr", "org_nr", "organisasjonsnummer", "organization_number"]) {
    const candidate = stringValue(properties[key]);
    if (candidate) return candidate.replace(/\s/g, "");
  }
  return null;
}

function crmSearchTerms(candidate: CrmCandidateInput) {
  const normalizedNameToken = normalizeCandidateName(candidate.companyName)
    .split(" ")
    .find((token) => token.length >= 4);
  return [...new Set([
    candidate.companyName.trim(),
    normalizeCandidateDomain(candidate.domain),
    normalizedNameToken,
  ].filter((value): value is string => Boolean(value)))];
}

export function findSafeCrmCompanyMatch(input: CrmCandidateInput, companies: CrmCompanyPayload[]) {
  const normalizedOrganizationNumber = input.organizationNumber?.replace(/\s/g, "") ?? null;
  const normalizedDomain = normalizeCandidateDomain(input.domain);
  const normalizedName = normalizeCandidateName(input.companyName);
  const matchingOrganizationNumbers = normalizedOrganizationNumber
    ? companies.filter((company) => companyOrganizationNumber(company) === normalizedOrganizationNumber)
    : [];
  const matchingDomains = normalizedDomain
    ? companies.filter((company) => companyDomain(company) === normalizedDomain)
    : [];
  const matchingNames = companies.filter((company) => {
    const value = companyName(company);
    return value ? normalizeCandidateName(value) === normalizedName : false;
  });
  const matches = matchingOrganizationNumbers.length
    ? matchingOrganizationNumbers
    : matchingDomains.length
      ? matchingDomains
      : matchingNames;
  if (matches.length !== 1) {
    return {
      company: null,
      status: matches.length > 1 ? "ambiguous" as const : "not_found" as const,
      matchMethod: null,
    };
  }
  return {
    company: matches[0],
    status: "matched" as const,
    matchMethod: matchingOrganizationNumbers.length === 1
      ? "organization_number" as const
      : matchingDomains.length === 1
        ? "domain" as const
        : "name" as const,
  };
}

function toContact(payload: CrmContactPayload): CandidateCrmContact | null {
  const id = numberValue(payload.id);
  if (!id) return null;
  const firstName = stringValue(payload.first_name);
  const lastName = stringValue(payload.last_name);
  return {
    id,
    name: (
      stringValue(payload.name)
      ?? stringValue(payload.full_name)
      ?? [firstName, lastName].filter(Boolean).join(" ")
    ) || "Uten navn",
    title: stringValue(payload.job_title) ?? stringValue(payload.title),
    email: stringValue(payload.email),
    owner: stringValue(payload.owner),
    lifecycleStage: stringValue(payload.lifecycle_stage) ?? stringValue(payload.lifecycleStage),
    leadStatus: stringValue(payload.lead_status) ?? stringValue(payload.leadStatus),
    contactRole: stringValue(payload.contact_role) ?? stringValue(payload.contactRole),
    updatedAt: stringValue(payload.updated_at) ?? stringValue(payload.updatedAt),
  };
}

async function crmGet<T>(input: {
  baseUrl: string;
  apiKey: string;
  path: string;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRM_TIMEOUT_MS);
  try {
    const response = await (input.fetchImpl ?? fetch)(`${input.baseUrl}${input.path}`, {
      headers: { Accept: "application/json", "X-API-Key": input.apiKey },
      signal: controller.signal,
    });
    if (response.status === 429) throw new CrmRequestError("rate_limit", "CRM begrenset oppslaget. Prøv igjen litt senere.");
    if (!response.ok) throw new CrmRequestError("upstream", `CRM kunne ikke hente selskapsdata (HTTP ${response.status}).`);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof CrmRequestError) throw error;
    if (controller.signal.aborted) throw new CrmRequestError("timeout", "CRM-oppslaget tok mer enn seks sekunder.");
    throw new CrmRequestError("upstream", "CRM-tilkoblingen feilet. Prøv igjen senere.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichCandidateFromCrm(
  candidate: CrmCandidateInput,
  config: { apiKey?: string; baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<CandidateCrmEnrichment> {
  const evaluatedAt = new Date().toISOString();
  const apiKey = config.apiKey;
  if (!apiKey) {
    return unavailableEnrichment(evaluatedAt, "CRM-tilkoblingen er ikke konfigurert.");
  }
  const baseUrl = (config.baseUrl ?? "https://crm.weme.eco/api").replace(/\/$/, "").replace(/\/agent$/, "");
  try {
    const candidateDomain = normalizeCandidateDomain(candidate.domain);
    const searchedContactsById = new Map<string, CrmContactPayload>();
    let match = findSafeCrmCompanyMatch(candidate, []);
    for (const search of crmSearchTerms(candidate)) {
      const searchParams = new URLSearchParams({ search, limit: "50" });
      const searchedContacts = contactList(await crmGet<unknown>({
        baseUrl,
        apiKey,
        path: `/agent/contacts?${searchParams.toString()}`,
        fetchImpl: config.fetchImpl,
      }));
      for (const contact of searchedContacts) {
        const key = String(contact.id ?? JSON.stringify(contact));
        searchedContactsById.set(key, contact);
      }
      match = findSafeCrmCompanyMatch(candidate, companiesFromContacts([...searchedContactsById.values()]));
      if (match.status === "matched") break;
    }
    if (!match.company || !match.matchMethod) {
      return {
        status: match.status,
        matchMethod: null,
        matchedCompanyName: null,
        matchedDomain: null,
        industry: null,
        contactCount: 0,
        lifecycleStages: [],
        leadStatuses: [],
        owners: [],
        relevantContacts: [],
        noteCount: 0,
        latestNoteAt: null,
        lastActivityAt: null,
        source: "weme_crm",
        evaluatedAt,
        availabilityMessage: null,
      };
    }
    const matchedName = companyName(match.company);
    if (!matchedName) return unavailableEnrichment(evaluatedAt, "CRM returnerte et treff uten verifiserbart selskapsnavn.");
    const companySearchParams = new URLSearchParams({ search: matchedName, limit: "50" });
    const matchedDomain = companyDomain(match.company) ?? candidateDomain;
    if (matchedDomain) companySearchParams.set("domain", matchedDomain);
    const companySearchContacts = contactList(await crmGet<unknown>({
      baseUrl,
      apiKey,
      path: `/agent/contacts?${companySearchParams.toString()}`,
      fetchImpl: config.fetchImpl,
    }));
    const matchedContactPayloads = companyContacts(companySearchContacts, match.company);
    const contacts = matchedContactPayloads.map(toContact).filter((contact): contact is CandidateCrmContact => Boolean(contact));
    const notes = (await Promise.all(
      contacts.slice(0, 10).map((contact) =>
        crmGet<unknown>({
          baseUrl,
          apiKey,
          path: `/agent/contacts/${contact.id}/notes`,
          fetchImpl: config.fetchImpl,
        }).then(noteList),
      ),
    )).flat();
    const lifecycleStages = [...new Set([
      ...contacts.map((contact) => contact.lifecycleStage).filter((value): value is string => Boolean(value)),
    ])];
    const leadStatuses = [...new Set([
      ...contacts.map((contact) => contact.leadStatus).filter((value): value is string => Boolean(value)),
    ])];
    const owners = [...new Set(contacts.map((contact) => contact.owner).filter((value): value is string => Boolean(value)))];
    const relevantContacts = contacts
      .filter((contact) => relevantRolePattern.test([contact.title, contact.contactRole].filter(Boolean).join(" ")))
      .slice(0, 5);
    const timestamps = [
      ...contacts.map((contact) => contact.updatedAt),
      ...notes.map((note) => note.createdAt),
    ].filter((value): value is string => Boolean(value)).sort();
    return {
      status: "matched",
      matchMethod: match.matchMethod,
      matchedCompanyName: matchedName,
      matchedDomain: companyDomain(match.company),
      industry: null,
      contactCount: contacts.length,
      lifecycleStages,
      leadStatuses,
      owners,
      relevantContacts,
      noteCount: notes.length,
      latestNoteAt: notes.map((note) => note.createdAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
      lastActivityAt: timestamps.at(-1) ?? null,
      source: "weme_crm",
      evaluatedAt,
      availabilityMessage: null,
    };
  } catch (error) {
    return unavailableEnrichment(
      evaluatedAt,
      error instanceof CrmRequestError ? error.message : "CRM-tilkoblingen feilet. Prøv igjen senere.",
    );
  }
}

function unavailableEnrichment(evaluatedAt: string, message: string): CandidateCrmEnrichment {
  return {
    status: "unavailable",
    matchMethod: null,
    matchedCompanyName: null,
    matchedDomain: null,
    industry: null,
    contactCount: 0,
    lifecycleStages: [],
    leadStatuses: [],
    owners: [],
    relevantContacts: [],
    noteCount: 0,
    latestNoteAt: null,
    lastActivityAt: null,
    source: "weme_crm",
    evaluatedAt,
    availabilityMessage: message,
  };
}