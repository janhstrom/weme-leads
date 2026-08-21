import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
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
  ImportSignalsBody,
  GetDashboardSummaryResponse,
  GetSignalParams,
  GetSignalResponse,
  ListSignalsQueryParams,
  ListSignalsResponse,
  ReviewSignalBody,
  ReviewSignalParams,
  ReviewSignalResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DAY = 1000 * 60 * 60 * 24;
let pilotSeedPromise: Promise<void> | null = null;

const pilotSignals = [
  {
    companyName: "Motek",
    employees: 180,
    industry: "Bygg og håndverk",
    domain: "motek.no",
    signalType: "Digital transformasjon",
    strength: "A",
    status: "allerede_kjent",
    summary:
      "Selskapet har offentlig kommunisert arbeid med ERP, sky og AI som del av en bredere modernisering.",
    rationale:
      "Kombinasjonen av ny teknologi og gjennomføringsbehov gjør endringskapasitet og forankring relevant.",
    publishedAt: "2026-08-14",
    evidence: [
      {
        title: "Modernisering av kjerneprosesser",
        url: "https://www.motek.no/nyheter/",
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-08-14",
        excerpt:
          "Pilotgrunnlag: ERP-, sky- og AI-initiativ skal verifiseres mot primærkilden før ny kontakt.",
      },
    ],
    contacts: [
      {
        id: 101,
        name: "Anbefalt kontakt",
        title: "COO / transformasjonsansvarlig",
        confidence: "fra_sales_navigator",
        rationale:
          "Eier typisk tverrfaglig gjennomføring når prosesser og teknologi endres samtidig.",
      },
    ] satisfies SignalContact[],
    crm: {
      status: "Eksisterende lead",
      matchCount: 1,
      note: "CRM viser «Prøvd å kontakte». Ikke start nytt løp uten avklaring.",
    } satisfies SignalCrm,
    suggestedOpening:
      "Når dere standardiserer prosesser rundt ERP og ny teknologi, hvor opplever dere at det menneskelige endringsarbeidet blir mest krevende?",
    dialogueDraft:
      "Jeg så at dere arbeider med å modernisere kjerneprosessene. WeMe hjelper virksomheter med å gjøre endringsarbeidet konkret i hverdagen når nye arbeidsmåter skal tas i bruk.",
  },
  {
    companyName: "Lyse",
    employees: 460,
    industry: "Energi og infrastruktur",
    domain: "lysekonsern.no",
    signalType: "Organisasjonsendring",
    strength: "B",
    status: "til_vurdering",
    summary:
      "Et eldre, men konkret signal om omorganisering og nye prioriteringer i konsernet.",
    rationale:
      "Store, tverrgående endringer krever tydelige roller, god intern kommunikasjon og lokal forankring.",
    publishedAt: "2026-06-18",
    evidence: [
      {
        title: "Endring i organisasjon og satsinger",
        url: "https://www.lysekonsern.no/nyheter/",
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-06-18",
        excerpt:
          "Pilotgrunnlag: Endringen er konkret, men må oppdateres med en fersk primærkilde før kontakt.",
      },
    ],
    contacts: [
      {
        id: 201,
        name: "Anbefalt kontakt",
        title: "Programleder / HR-leder",
        confidence: "fra_sales_navigator",
        rationale:
          "Er ofte tett på oversettelsen fra ny struktur til nye arbeidsmåter.",
      },
    ] satisfies SignalContact[],
    crm: { status: "Ingen konflikt funnet", matchCount: 0, note: null } satisfies SignalCrm,
    suggestedOpening:
      "Når en ny organisering skal fungere i praksis, hva er viktigst å få på plass hos lederne de første månedene?",
    dialogueDraft:
      "Vi følger virksomheter som står i endring på tvers av struktur, ledelse og arbeidsmåter. Jeg ble nysgjerrig på hvordan dere jobber med å gjøre endringen enkel å forstå og ta i bruk.",
  },
  {
    companyName: "Hydro",
    employees: 500,
    industry: "Industri",
    domain: "hydro.com",
    signalType: "Strategiimplementering",
    strength: "B",
    status: "følg_videre",
    summary:
      "Et strategisk omstillingssignal med tydelig relevans, men uten tilstrekkelig fersk dokumentasjon.",
    rationale:
      "Strategi blir først verdiskapende når nye prioriteringer oversettes til konkrete valg og vaner.",
    publishedAt: "2026-05-27",
    evidence: [
      {
        title: "Oppdatering om strategiske prioriteringer",
        url: "https://www.hydro.com/no-NO/media/news/",
        sourceType: "Presserom",
        publishedAt: "2026-05-27",
        excerpt:
          "Pilotgrunnlag: Følg utviklingen, men vent med kontakt til et nytt, konkret endringssignal foreligger.",
      },
    ],
    contacts: [
      {
        id: 301,
        name: "Anbefalt kontakt",
        title: "Strategi- eller programleder",
        confidence: "ikke_verifisert",
        rationale: "Rollen er relevant, men person og mandat må verifiseres.",
      },
    ] satisfies SignalContact[],
    crm: { status: "Ingen konflikt funnet", matchCount: 0, note: null } satisfies SignalCrm,
    suggestedOpening:
      "Hva trenger ledere og nøkkelpersoner for å gjøre de strategiske prioriteringene operative i hverdagen?",
    dialogueDraft:
      "Vi er opptatt av gapet mellom en tydelig strategi og hvordan den faktisk lander hos ledere og ansatte. Det er ofte her vi hjelper team med å skape fremdrift.",
  },
  {
    companyName: "Mills",
    employees: 330,
    industry: "Forbrukervarer",
    domain: "mills.no",
    signalType: "Omstilling",
    strength: "B",
    status: "til_vurdering",
    summary:
      "Historisk signal om omstilling med mulig relevans for ledelse, prioritering og nye arbeidsformer.",
    rationale:
      "Signalets alder senker tempoet, men gjør kontoen egnet for en undersøkende og ikke-selgende inngang.",
    publishedAt: "2026-06-05",
    evidence: [
      {
        title: "Endring og nye prioriteringer",
        url: "https://mills.no/om-mills/nyheter/",
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-06-05",
        excerpt:
          "Pilotgrunnlag: Verifiser endringens nåværende fase med en ny kilde eller CRM-kontakt før oppfølging.",
      },
    ],
    contacts: [
      {
        id: 401,
        name: "Anbefalt kontakt",
        title: "HR-direktør / endringsleder",
        confidence: "fra_sales_navigator",
        rationale:
          "Kan knytte virksomhetens prioriteringer til lederstøtte og endringskapasitet.",
      },
    ] satisfies SignalContact[],
    crm: { status: "Ingen konflikt funnet", matchCount: 0, note: null } satisfies SignalCrm,
    suggestedOpening:
      "Har dere en felles måte å hjelpe ledere med å omsette nye prioriteringer til praksis i teamene sine?",
    dialogueDraft:
      "Mange virksomheter lykkes med retningen, men bruker unødvendig mye energi på å få endringen til å leve i hverdagen. Det er nettopp det rommet WeMe er bygget for.",
  },
  {
    companyName: "DIPS",
    employees: 260,
    industry: "Helse-teknologi",
    domain: "dips.com",
    signalType: "AI-adopsjon",
    strength: "A",
    status: "til_vurdering",
    summary:
      "Et ferskt signal om ny teknologi som vil kreve endrede arbeidsprosesser og god involvering.",
    rationale:
      "AI-innføring får større effekt når kliniske, tekniske og kommersielle miljøer får en felles endringsrytme.",
    publishedAt: "2026-08-08",
    evidence: [
      {
        title: "Nye initiativ innen teknologi og arbeidsflyt",
        url: "https://www.dips.com/no/nyheter/",
        sourceType: "Selskapsnyhet",
        publishedAt: "2026-08-08",
        excerpt:
          "Pilotgrunnlag: Et aktuelt teknologispor med tydelig mulig endringsbehov; primærkilde må kvalitetssikres før kontakt.",
      },
    ],
    contacts: [
      {
        id: 501,
        name: "Anbefalt kontakt",
        title: "Produkt- eller programleder",
        confidence: "fra_sales_navigator",
        rationale:
          "Kan binde sammen produktinnføring, kundeadopsjon og intern gjennomføring.",
      },
    ] satisfies SignalContact[],
    crm: { status: "Ingen konflikt funnet", matchCount: 0, note: null } satisfies SignalCrm,
    suggestedOpening:
      "Når ny teknologi skal inn i etablerte arbeidsflyter, hva gjør dere for å sikre at de som skal bruke den faktisk opplever nytten?",
    dialogueDraft:
      "Jeg så at dere utforsker nye teknologiske arbeidsflyter. WeMe hjelper endringsledere med å skape forståelse, trening og fremdrift når løsningen skal fungere i praksis.",
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
  contacts: Omit<SignalContact, "crmContactId">[];
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

  let response = await fetch(parsed, { method: "HEAD", redirect: "follow" });
  if (response.status === 405) {
    response = await fetch(parsed, { method: "GET", redirect: "follow" });
  }
  if (!response.ok) {
    throw new Error(`Kilden kunne ikke verifiseres (HTTP ${response.status}).`);
  }
  return {
    ...input,
    title: input.title.trim(),
    excerpt: input.excerpt.trim(),
    verificationStatus: "verified",
    verifiedAt: new Date().toISOString(),
  };
}

function withSeedVerification(evidence: SignalEvidence[] | Omit<SignalEvidence, "verificationStatus" | "verifiedAt">[]) {
  return evidence.map((item) => ({
    ...item,
    verificationStatus: "verified" as const,
    verifiedAt: new Date().toISOString(),
  }));
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
    // Normalize rows created by the original pilot fixture so an existing
    // database remains readable after verification metadata was introduced.
    evidence: signal.evidence.map((item) => ({
      ...item,
      verificationStatus: item.verificationStatus ?? "verified",
      verifiedAt: item.verifiedAt ?? signal.updatedAt.toISOString(),
    })),
    contacts: signal.contacts.map(({ crmContactId: _crmContactId, ...contact }) => contact),
    crm: signal.crm,
    suggestedOpening: signal.suggestedOpening,
    dialogueDraft: signal.dialogueDraft,
    reviewReason: signal.reviewReason,
    reviewComment: signal.reviewComment,
  };
}

async function seedPilotSignals(): Promise<void> {
  const existing = await db.select({ id: signalpilotSignalsTable.id }).from(signalpilotSignalsTable).limit(1);
  if (existing.length > 0) return;

  await db.insert(signalpilotSignalsTable).values(
    pilotSignals.map((signal) => ({ ...signal, evidence: withSeedVerification(signal.evidence) })),
  );
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
    if (signal && signal.evidence.some((item) => item.verificationStatus !== "verified")) {
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
  const body = ImportSignalsBody.safeParse(req.body);
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
      res.status(502).json({
        error: "CRM-notatet ble opprettet, men CRM kunne ikke opprette oppgaven. Sjekk CRM før du prøver igjen.",
      });
      return;
    }

    const taskPayload = (await taskResponse.json().catch(() => null)) as { id?: number } | null;
    await db
      .update(signalpilotSignalsTable)
      .set({ crmTaskCreated: true })
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

export default router;