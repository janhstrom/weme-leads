import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  signalpilotSignalsTable,
  type SignalContact,
  type SignalCrm,
  type SignalEvidence,
  type SignalpilotSignal,
} from "@workspace/db";
import {
  CreateCrmTaskBody,
  CreateCrmTaskParams,
  CreateCrmTaskResponse,
  AddSignalEvidenceBody,
  AddSignalEvidenceParams,
  ImportSignalBatchBody,
  GetDashboardSummaryResponse,
  GetSignalParams,
  GetSignalResponse,
  ListSignalsQueryParams,
  ListSignalsResponse,
  ReviewSignalBody,
  ReviewSignalParams,
  ReviewSignalResponse,
  SearchCrmContactsQueryParams,
  VerifySignalCrmContactBody,
  VerifySignalCrmContactParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DAY = 1000 * 60 * 60 * 24;
const EVIDENCE_CHECK_TIMEOUT_MS = 6_000;
let pilotSeedPromise: Promise<void> | null = null;
const legacyPilotSourceUrls = new Set([
  "https://www.motek.no/nyheter/",
  "https://www.lysekonsern.no/nyheter/",
  "https://www.hydro.com/no-NO/media/news/",
  "https://mills.no/om-mills/nyheter/",
  "https://www.dips.com/no/nyheter/",
]);

const pilotSignals = [
  {
    companyName: "Motek",
    employees: 360,
    industry: "Bygg og håndverk",
    domain: "motek.no",
    signalType: "Digital adopsjon",
    strength: "B",
    status: "til_vurdering",
    summary:
      "Motek har lansert en digital læringsplattform for fagfolk som skal ta i bruk Profis Engineering i arbeidshverdagen.",
    rationale:
      "Nye digitale arbeidsverktøy krever at brukere får praktisk opplæring og lykkes med å endre vaner i hverdagen.",
    publishedAt: "2025-04-04",
    evidence: [
      {
        title: "Profis eLearning",
        url: "https://www.mynewsdesk.com/no/motek/pressreleases/profis-elearning-3379464",
        sourceType: "Pressemelding fra selskapet",
        publishedAt: "2025-04-04",
        excerpt:
          "Motek lanserer en digital læringsplattform for ingeniører og fagfolk som jobber med design av ankerløsninger.",
      },
    ],
    contacts: [
      {
        id: 101,
        name: "Anbefalt kontakt",
        title: "Leder for kompetanse eller digital adopsjon",
        confidence: "fra_sales_navigator",
        rationale:
          "Er typisk nær både utrulling av digitale verktøy og hvordan brukerne støttes i å ta dem i bruk.",
      },
    ] satisfies SignalContact[],
    crm: {
      status: "Ingen konflikt funnet",
      matchCount: 0,
      note: null,
    } satisfies SignalCrm,
    suggestedOpening:
      "Når nye digitale verktøy skal fungere ute i prosjektene, hva er viktigst for at brukerne faktisk tar dem i bruk?",
    dialogueDraft:
      "Jeg så at dere har lansert en digital læringsplattform for Profis Engineering. WeMe hjelper virksomheter med å gjøre opplæring og endrede arbeidsmåter konkrete i arbeidshverdagen.",
  },
  {
    companyName: "Lyse",
    employees: 1200,
    industry: "Energi og infrastruktur",
    domain: "lysekonsern.no",
    signalType: "Organisasjonsendring",
    strength: "A",
    status: "til_vurdering",
    summary:
      "Lyse Tele varsler organisasjonsjusteringer og nedbemanning for å etablere en enklere og mer effektiv driftsmodell.",
    rationale:
      "Endringer i struktur, roller og driftsmodell krever tydelig lederkommunikasjon og lokal forankring.",
    publishedAt: "2025-11-04",
    evidence: [
      {
        title: "Varsler nedbemanning i Lyses televirksomhet",
        url: "https://www.lysekonsern.no/om-oss/nyhetsarkiv/varsler-nedbemanning-i-lyses-televirksomhet",
        sourceType: "Selskapsnyhet",
        publishedAt: "2025-11-04",
        excerpt:
          "Målet er å etablere en enklere og mer effektiv driftsmodell etter erfaringer fra sammenslåingen av virksomhetene.",
      },
    ],
    contacts: [
      {
        id: 201,
        name: "Anbefalt kontakt",
        title: "Programleder, HR-leder eller endringsleder",
        confidence: "fra_sales_navigator",
        rationale:
          "Er ofte tett på oversettelsen fra ny struktur til nye arbeidsmåter.",
      },
    ] satisfies SignalContact[],
    crm: { status: "Ingen konflikt funnet", matchCount: 0, note: null } satisfies SignalCrm,
    suggestedOpening:
      "Når en ny driftsmodell skal fungere i praksis, hva trenger lederne for å gi medarbeiderne tydelig retning i den første fasen?",
    dialogueDraft:
      "Jeg så at Lyse Tele gjør organisasjonsjusteringer for å etablere en enklere driftsmodell. WeMe hjelper virksomheter med å gjøre strukturendringer forståelige og gjennomførbare i hverdagen.",
  },
  {
    companyName: "Hydro",
    employees: 34000,
    industry: "Industri",
    domain: "hydro.com",
    signalType: "Organisasjonsendring",
    strength: "A",
    status: "til_vurdering",
    summary:
      "Hydro har varslet kostnadskutt og en organisatorisk tilpasning som omfatter om lag 750 stillinger.",
    rationale:
      "En større tilpasning i roller og støttefunksjoner øker behovet for å få endringen tydelig og omsorgsfullt ut i organisasjonen.",
    publishedAt: "2025-08-14",
    evidence: [
      {
        title: "Hydro cuts costs and carries out strategic workforce adjustment",
        url: "https://www.hydro.com/en/global/media/news/2025/hydro-cuts-costs-and-carries-out-strategic-workforce-adjustment/",
        sourceType: "Presserom",
        publishedAt: "2025-08-14",
        excerpt:
          "Hydro skal redusere årlige kostnader med én milliard kroner og tilpasse organisasjonen til strategiske mål og endrede forretningsbehov.",
      },
    ],
    contacts: [
      {
        id: 301,
        name: "Anbefalt kontakt",
        title: "HR-, endrings- eller programleder",
        confidence: "fra_sales_navigator",
        rationale: "Rollen er relevant for å omsette en større organisatorisk tilpasning til tydelig praksis og oppfølging.",
      },
    ] satisfies SignalContact[],
    crm: { status: "Ingen konflikt funnet", matchCount: 0, note: null } satisfies SignalCrm,
    suggestedOpening:
      "Når en organisatorisk tilpasning skal gjennomføres med åpenhet og omsorg, hva er viktigst for å gi lederne støtte i den første fasen?",
    dialogueDraft:
      "Jeg så at Hydro har varslet en organisatorisk tilpasning som berører støttefunksjoner, engineering, kommersielle miljøer og IT. WeMe hjelper ledere med å gjøre store endringer tydelige og gjennomførbare i hverdagen.",
  },
];

type SignalResponse = {
  id: number;
  company: { name: string; employees: number; industry: string; domain: string };
  signalType: string;
  strength: "A" | "B" | "C";
  status: "til_vurdering" | "godkjent" | "avvist" | "allerede_kjent" | "følg_videre";
  summary: string;
  rationale: string;
  publishedAt: string;
  freshnessDays: number;
  evidence: SignalEvidence[];
  contacts: SignalContact[];
  crm: SignalCrm;
  suggestedOpening: string;
  dialogueDraft: string;
  reviewReason: string | null;
  reviewComment: string | null;
};

async function verifyPublicEvidence(input: {
  title: string;
  url: string;
  sourceType: string;
  publishedAt: string;
  excerpt: string;
}): Promise<SignalEvidence> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error("Kilden må være en gyldig URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Kilden må bruke HTTPS.");
  }
  if (input.title.trim().length < 5 || input.excerpt.trim().length < 20) {
    throw new Error("Kilden må ha en kvalitetssikret tittel og et sitat på minst 20 tegn.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.publishedAt)) {
    throw new Error("Publiseringsdato må være på formatet YYYY-MM-DD.");
  }

  const fetchWithTimeout = async (method: "HEAD" | "GET") => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EVIDENCE_CHECK_TIMEOUT_MS);
    try {
      return await fetch(parsed, { method, redirect: "follow", signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Kildekontrollen tok mer enn seks sekunder.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  let response = await fetchWithTimeout("HEAD");
  if (response.status === 405) {
    response = await fetchWithTimeout("GET");
  }
  if (!response.ok) {
    throw new Error(`Kilden kunne ikke verifiseres (HTTP ${response.status}).`);
  }
  return {
    ...input,
    title: input.title.trim(),
    excerpt: input.excerpt.trim(),
    verificationStatus: "url_verified",
    verifiedAt: new Date().toISOString(),
  };
}

function toSignalResponse(signal: SignalpilotSignal): SignalResponse {
  const freshnessDays = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(`${signal.publishedAt}T00:00:00Z`)) / DAY),
  );

  return {
    id: signal.id,
    company: {
      name: signal.companyName,
      employees: signal.employees,
      industry: signal.industry,
      domain: signal.domain,
    },
    signalType: signal.signalType,
    strength: signal.strength as SignalResponse["strength"],
    status: signal.status as SignalResponse["status"],
    summary: signal.summary,
    rationale: signal.rationale,
    publishedAt: signal.publishedAt,
    freshnessDays,
    evidence: signal.evidence.map((item) => ({
      ...item,
      verificationStatus: "url_verified" as const,
      verifiedAt: item.verifiedAt ?? signal.updatedAt.toISOString(),
    })),
    contacts: signal.contacts,
    crm: signal.crm,
    suggestedOpening: signal.suggestedOpening,
    dialogueDraft: signal.dialogueDraft,
    reviewReason: signal.reviewReason,
    reviewComment: signal.reviewComment,
  };
}

async function seedPilotSignals(): Promise<void> {
  const existing = await db.select().from(signalpilotSignalsTable);
  const legacySignals = existing.filter((signal) =>
    signal.evidence.some((item) => legacyPilotSourceUrls.has(item.url)),
  );

  if (legacySignals.length > 0) {
    await db
      .delete(signalpilotSignalsTable)
      .where(inArray(signalpilotSignalsTable.id, legacySignals.map((signal) => signal.id)));
  }

  const remaining = await db.select().from(signalpilotSignalsTable);
  const existingCompanies = new Set(remaining.map((signal) => signal.companyName));
  const candidates = pilotSignals.filter((signal) => !existingCompanies.has(signal.companyName));
  const verifiedCandidates = await Promise.allSettled(
    candidates.map(async (signal) => ({
      ...signal,
      evidence: await Promise.all(signal.evidence.map((item) => verifyPublicEvidence(item))),
    })),
  );
  const readyCandidates = verifiedCandidates.flatMap((candidate) => {
    if (candidate.status === "fulfilled") return [candidate.value];
    console.warn("Pilotkilde ble ikke lagt inn fordi URL-en ikke kunne kontrolleres.", candidate.reason);
    return [];
  });

  if (readyCandidates.length > 0) {
    await db.insert(signalpilotSignalsTable).values(readyCandidates);
  }
}

async function ensurePilotSignals(): Promise<void> {
  if (!pilotSeedPromise) {
    pilotSeedPromise = seedPilotSignals().catch((error: unknown) => {
      pilotSeedPromise = null;
      throw error;
    });
  }
  await pilotSeedPromise;
}

async function findSignal(id: number): Promise<SignalpilotSignal | undefined> {
  await ensurePilotSignals();
  const [signal] = await db
    .select()
    .from(signalpilotSignalsTable)
    .where(eq(signalpilotSignalsTable.id, id));
  return signal;
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  await ensurePilotSignals();
  const signals = await db.select().from(signalpilotSignalsTable);

  res.json(
    GetDashboardSummaryResponse.parse({
      total: signals.length,
      pending: signals.filter((signal) => signal.status === "til_vurdering").length,
      approved: signals.filter((signal) => signal.status === "godkjent").length,
      highPriority: signals.filter(
        (signal) => signal.strength === "A" && signal.status === "til_vurdering",
      ).length,
      crmTasks: signals.filter((signal) => signal.crmTaskCreated).length,
    }),
  );
});

router.get("/signals", async (req, res): Promise<void> => {
  const query = ListSignalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  await ensurePilotSignals();
  let signals = await db
    .select()
    .from(signalpilotSignalsTable)
    .orderBy(asc(signalpilotSignalsTable.publishedAt));

  if (query.data.status) {
    signals = signals.filter((signal) => signal.status === query.data.status);
  }
  if (query.data.strength) {
    signals = signals.filter((signal) => signal.strength === query.data.strength);
  }
  if (query.data.search) {
    const needle = query.data.search.toLocaleLowerCase("nb-NO");
    signals = signals.filter((signal) =>
      [signal.companyName, signal.industry, signal.signalType, signal.summary]
        .join(" ")
        .toLocaleLowerCase("nb-NO")
        .includes(needle),
    );
  }

  res.json(ListSignalsResponse.parse(signals.map(toSignalResponse)));
});

router.get("/signals/:id", async (req, res): Promise<void> => {
  const params = GetSignalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const signal = await findSignal(params.data.id);
  if (!signal) {
    res.status(404).json({ error: "Signalet finnes ikke" });
    return;
  }

  res.json(GetSignalResponse.parse(toSignalResponse(signal)));
});

router.post("/signals/:id/review", async (req, res): Promise<void> => {
  const params = ReviewSignalParams.safeParse(req.params);
  const body = ReviewSignalBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.status === "godkjent") {
    const signal = await findSignal(params.data.id);
    if (signal && signal.evidence.some((item) => item.verificationStatus !== "url_verified")) {
      res.status(400).json({ error: "Signalet kan ikke godkjennes før alle kilder er verifisert." });
      return;
    }
  }

  const [signal] = await db
    .update(signalpilotSignalsTable)
    .set({
      status: body.data.status,
      reviewReason: body.data.reason ?? null,
      reviewComment: body.data.comment ?? null,
    })
    .where(eq(signalpilotSignalsTable.id, params.data.id))
    .returning();

  if (!signal) {
    res.status(404).json({ error: "Signalet finnes ikke" });
    return;
  }

  res.json(ReviewSignalResponse.parse(toSignalResponse(signal)));
});

router.post("/signals/:id/evidence", async (req, res): Promise<void> => {
  const params = AddSignalEvidenceParams.safeParse(req.params);
  const body = AddSignalEvidenceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Tittel, HTTPS-URL, publiseringsdato, kildetype og sitat er påkrevd." });
    return;
  }
  const signal = await findSignal(params.data.id);
  if (!signal) {
    res.status(404).json({ error: "Signalet finnes ikke" });
    return;
  }
  try {
    const evidence = await verifyPublicEvidence({
      ...body.data,
      publishedAt: body.data.publishedAt.toISOString().slice(0, 10),
    });
    const [updated] = await db
      .update(signalpilotSignalsTable)
      .set({ evidence: [...signal.evidence, evidence], updatedAt: new Date() })
      .where(eq(signalpilotSignalsTable.id, signal.id))
      .returning();
    res.status(201).json(GetSignalResponse.parse(toSignalResponse(updated)));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Kilden kunne ikke verifiseres." });
  }
});

router.post("/signals/import", async (req, res): Promise<void> => {
  const body = ImportSignalBatchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Importen mangler felter eller har feil format." });
    return;
  }
  let imported = 0;
  let skipped = 0;
  const warnings: string[] = [];
  for (const candidate of body.data.signals) {
    try {
      if (candidate.evidence.length === 0) throw new Error("minst én kilde er påkrevd");
      const evidence = await Promise.all(
        candidate.evidence.map((item) =>
          verifyPublicEvidence({
            ...item,
            publishedAt: item.publishedAt.toISOString().slice(0, 10),
          }),
        ),
      );
      await db.insert(signalpilotSignalsTable).values({
        ...candidate,
        publishedAt: candidate.publishedAt.toISOString().slice(0, 10),
        contacts: candidate.contacts.map((contact) => ({
          ...contact,
          rationale: contact.rationale ?? "",
        })),
        evidence,
        status: "til_vurdering",
      });
      imported += 1;
    } catch (error) {
      skipped += 1;
      warnings.push(`${candidate.companyName}: ${error instanceof Error ? error.message : "kunne ikke importeres"}`);
    }
  }
  res.status(201).json({ imported, skipped, warnings });
});

router.post("/signals/:id/crm-task", async (req, res): Promise<void> => {
  const params = CreateCrmTaskParams.safeParse(req.params);
  const body = CreateCrmTaskBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const signal = await findSignal(params.data.id);
  if (!signal) {
    res.status(404).json({ error: "Signalet finnes ikke" });
    return;
  }
  if (signal.status !== "godkjent") {
    res.status(400).json({ error: "Godkjenn signalet før du oppretter en CRM-oppgave." });
    return;
  }

  const contact = signal.contacts.find((item) => item.id === body.data.contactId);
  if (!contact?.crmContactId) {
    res.status(400).json({
      error:
        "Kontakten er ikke koblet mot en verifisert CRM-kontakt ennå. Verifiser matchen før du oppretter oppgave.",
    });
    return;
  }
  if (signal.crm.writeStatus === "completed") {
    res.status(400).json({ error: "Notat og oppgave er allerede synkronisert til CRM for denne kontakten." });
    return;
  }

  const apiKey = process.env.WEME_CRM_API_KEY;
  if (!apiKey) {
    req.log.error("CRM API key is not configured");
    res.status(502).json({ error: "CRM-tilkoblingen er ikke konfigurert." });
    return;
  }

  const crmBaseUrl = process.env.WEME_CRM_BASE_URL ?? "https://crm.weme.eco/api/agent";
  const note = [
    `WeMe Signalpilot — ${signal.signalType}`,
    signal.summary,
    `Kilde: ${signal.evidence[0]?.title ?? "Ikke oppgitt"} (${signal.evidence[0]?.url ?? ""})`,
    `Anbefalt inngang: ${signal.suggestedOpening}`,
  ].join("\n\n");
  const task = {
    title: `Følg opp ${signal.companyName}: ${signal.signalType}`,
    due_date: body.data.dueDate.toISOString().slice(0, 10),
    description: `${signal.dialogueDraft}\n\nOppfølgingsspørsmål: ${signal.suggestedOpening}`,
  };

  try {
    await db
      .update(signalpilotSignalsTable)
      .set({ crm: { ...signal.crm, writeStatus: "pending", crmContactId: contact.crmContactId }, updatedAt: new Date() })
      .where(eq(signalpilotSignalsTable.id, signal.id));
    const headers = {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    };
    const noteResponse = await fetch(`${crmBaseUrl}/contacts/${contact.crmContactId}/notes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: note }),
    });
    if (!noteResponse.ok) {
      req.log.warn({ status: noteResponse.status }, "CRM note request failed");
      await db
        .update(signalpilotSignalsTable)
        .set({ crm: { ...signal.crm, writeStatus: "failed", crmContactId: contact.crmContactId }, updatedAt: new Date() })
        .where(eq(signalpilotSignalsTable.id, signal.id));
      res.status(502).json({ error: "CRM kunne ikke opprette notatet. Ingen oppgave ble opprettet." });
      return;
    }

    const taskResponse = await fetch(`${crmBaseUrl}/contacts/${contact.crmContactId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(task),
    });
    if (!taskResponse.ok) {
      req.log.warn({ status: taskResponse.status }, "CRM task request failed");
      await db
        .update(signalpilotSignalsTable)
        .set({
          crm: {
            ...signal.crm,
            writeStatus: "partial",
            crmContactId: contact.crmContactId,
            noteCreatedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(signalpilotSignalsTable.id, signal.id));
      res.status(502).json({
        error: "CRM-notatet ble opprettet, men CRM kunne ikke opprette oppgaven. Sjekk CRM før du prøver igjen.",
      });
      return;
    }

    const taskPayload = (await taskResponse.json().catch(() => null)) as { id?: number } | null;
    const completedAt = new Date().toISOString();
    await db
      .update(signalpilotSignalsTable)
      .set({
        crmTaskCreated: true,
        crm: {
          ...signal.crm,
          writeStatus: "completed",
          crmContactId: contact.crmContactId,
          noteCreatedAt: completedAt,
          taskCreatedAt: completedAt,
          taskId: taskPayload?.id ?? null,
        },
        updatedAt: new Date(),
      })
      .where(eq(signalpilotSignalsTable.id, signal.id));

    res.status(201).json(
      CreateCrmTaskResponse.parse({
        signalId: signal.id,
        crmContactId: contact.crmContactId,
        crmNoteCreated: true,
        crmTaskCreated: true,
        taskId: taskPayload?.id ?? null,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "CRM connection failed");
    res.status(502).json({ error: "CRM-tilkoblingen feilet. Prøv igjen senere." });
  }
});

type CrmContactPayload = {
  id?: number | string;
  name?: string;
  full_name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  company?: { name?: string | null; domain?: string | null };
};

function crmContactCandidate(payload: CrmContactPayload) {
  const id = Number(payload.id);
  return {
    id,
    name: payload.name ?? payload.full_name ?? "Uten navn",
    title: payload.title ?? "",
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    companyName: payload.company_name ?? payload.company?.name ?? null,
    companyDomain: payload.company_domain ?? payload.company?.domain ?? null,
  };
}

function crmContactList(payload: unknown): CrmContactPayload[] {
  if (Array.isArray(payload)) return payload as CrmContactPayload[];
  if (payload && typeof payload === "object") {
    const value = payload as { contacts?: unknown; data?: unknown; results?: unknown };
    for (const candidate of [value.contacts, value.data, value.results]) {
      if (Array.isArray(candidate)) return candidate as CrmContactPayload[];
    }
  }
  return [];
}

router.get("/crm/contacts/search", async (req, res): Promise<void> => {
  const query = SearchCrmContactsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Søk og selskapsdomene er påkrevd." });
    return;
  }
  const apiKey = process.env.WEME_CRM_API_KEY;
  if (!apiKey) {
    res.status(502).json({ error: "CRM-tilkoblingen er ikke konfigurert." });
    return;
  }

  const crmBaseUrl = process.env.WEME_CRM_BASE_URL ?? "https://crm.weme.eco/api/agent";
  const searchUrl = new URL(`${crmBaseUrl}/contacts`);
  searchUrl.searchParams.set("search", query.data.query);
  searchUrl.searchParams.set("domain", query.data.companyDomain);

  try {
    const response = await fetch(searchUrl, { headers: { Accept: "application/json", "X-API-Key": apiKey } });
    if (!response.ok) {
      req.log.warn({ status: response.status }, "CRM contact search failed");
      res.status(502).json({ error: "CRM kunne ikke søke etter kontakter." });
      return;
    }
    const candidates = crmContactList(await response.json())
      .map(crmContactCandidate)
      .filter((contact) => Number.isFinite(contact.id) && contact.id > 0);
    res.json(candidates);
  } catch (error) {
    req.log.error({ err: error }, "CRM contact search connection failed");
    res.status(502).json({ error: "CRM-tilkoblingen feilet. Prøv igjen senere." });
  }
});

router.post("/signals/:id/crm-contact", async (req, res): Promise<void> => {
  const params = VerifySignalCrmContactParams.safeParse(req.params);
  const body = VerifySignalCrmContactBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Signal-, kontakt- og CRM-ID er påkrevd." });
    return;
  }
  const signal = await findSignal(params.data.id);
  if (!signal) {
    res.status(404).json({ error: "Signalet finnes ikke" });
    return;
  }
  const contact = signal.contacts.find((item) => item.id === body.data.contactId);
  if (!contact) {
    res.status(400).json({ error: "Kontakten finnes ikke på dette signalet." });
    return;
  }
  const apiKey = process.env.WEME_CRM_API_KEY;
  if (!apiKey) {
    res.status(502).json({ error: "CRM-tilkoblingen er ikke konfigurert." });
    return;
  }

  const crmBaseUrl = process.env.WEME_CRM_BASE_URL ?? "https://crm.weme.eco/api/agent";
  try {
    const response = await fetch(`${crmBaseUrl}/contacts/${body.data.crmContactId}`, {
      headers: { Accept: "application/json", "X-API-Key": apiKey },
    });
    if (!response.ok) {
      res.status(400).json({ error: "CRM-kontakten kunne ikke verifiseres." });
      return;
    }
    const candidate = crmContactCandidate((await response.json()) as CrmContactPayload);
    const expectedDomain = signal.domain.toLowerCase().replace(/^www\./, "");
    const actualDomain = candidate.companyDomain?.toLowerCase().replace(/^www\./, "");
    if (!actualDomain || actualDomain !== expectedDomain) {
      res.status(400).json({ error: "CRM-kontakten tilhører ikke riktig selskap." });
      return;
    }

    const contacts = signal.contacts.map((item) =>
      item.id === contact.id
        ? {
            ...item,
            crmContactId: candidate.id,
            name: candidate.name,
            title: candidate.title || item.title,
            email: candidate.email,
            phone: candidate.phone,
            confidence: "fra_crm" as const,
          }
        : item,
    );
    const [updated] = await db
      .update(signalpilotSignalsTable)
      .set({
        contacts,
        crm: {
          ...signal.crm,
          status: "Verifisert CRM-match",
          matchCount: 1,
          crmContactId: candidate.id,
          writeStatus: signal.crm.writeStatus ?? "not_started",
        },
        updatedAt: new Date(),
      })
      .where(eq(signalpilotSignalsTable.id, signal.id))
      .returning();
    res.json(GetSignalResponse.parse(toSignalResponse(updated)));
  } catch (error) {
    req.log.error({ err: error }, "CRM contact verification failed");
    res.status(502).json({ error: "CRM-tilkoblingen feilet. Prøv igjen senere." });
  }
});

export default router;