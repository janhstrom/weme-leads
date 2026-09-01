import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import {
  Candidate,
  getListCandidateSourcesQueryKey,
  getSearchCrmContactsQueryKey,
  getGetCandidateQueryKey,
  getListCandidatesQueryKey,
  useAddCandidateEvidence,
  useCreateCandidateSource,
  useEnrichCandidateCrm,
  useGetCandidate,
  useListCandidateSources,
  useSearchCrmContacts,
  useStartEventMappingRun,
  useUpdateCandidateMonitoring,
  useUpdateCandidateRelevance,
} from "@workspace/api-client-react";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";
import { Button } from "@workspace/weme-earth-tones-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Input } from "@workspace/weme-earth-tones-system/components/ui/input";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { Textarea } from "@workspace/weme-earth-tones-system/components/ui/textarea";
import { useToast } from "@workspace/weme-earth-tones-system/hooks/use-toast";
import { AlertCircle, ArrowLeft, Building2, DatabaseZap, Eye, ExternalLink, FileSearch, Link2, Radio, Search, UserRound, X } from "lucide-react";
import { MonitoringBadge, PriorityBadge, RelevanceBadge } from "@/components/status-badges";

type ManualRelevanceStatus = Exclude<Candidate["relevanceStatus"], "insufficient_data">;

export default function CandidateDetailPage() {
  const [, params] = useRoute("/candidates/:id");
  const id = Number(params?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [mappingRunning, setMappingRunning] = useState(false);
  const { data: candidate, isLoading, isError } = useGetCandidate(id, {
    query: { queryKey: getGetCandidateQueryKey(id), refetchInterval: mappingRunning ? 1_500 : false },
  });
  const [crmQuery, setCrmQuery] = useState("");
  const [form, setForm] = useState({ title: "", url: "", sourceType: "Selskapsnyhet", publishedAt: "", excerpt: "" });
  const [sourceForm, setSourceForm] = useState<{ sourceType: "rss" | "atom"; label: string; url: string }>({ sourceType: "rss", label: "", url: "" });
  const [relevanceChoice, setRelevanceChoice] = useState<ManualRelevanceStatus | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [duplicateEvidenceUrl, setDuplicateEvidenceUrl] = useState<string | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const submitEvidence = () => {
    if (!candidate) return;
    setDuplicateEvidenceUrl(null);
    setEvidenceError(null);
    const validationError = validateEvidenceForm(form);
    if (validationError) {
      setEvidenceError(validationError);
      toast({ title: "Kilden mangler opplysninger", description: validationError, variant: "destructive" });
      return;
    }
    evidenceMutation.mutate({
      id: candidate.id,
      data: {
        title: form.title.trim(),
        url: form.url.trim(),
        sourceType: form.sourceType.trim(),
        publishedAt: form.publishedAt,
        excerpt: form.excerpt.trim(),
      },
    });
  };
  const crmSearchParams = { query: crmQuery, companyDomain: candidate?.domain ?? "" };
  const sources = useListCandidateSources(id, { query: { enabled: Number.isFinite(id) && id > 0, queryKey: getListCandidateSourcesQueryKey(id) } });
  const crm = useSearchCrmContacts(
    crmSearchParams,
    { query: { enabled: Boolean(candidate?.domain && crmQuery.trim().length >= 2), queryKey: getSearchCrmContactsQueryKey(crmSearchParams) } },
  );
  const evidenceMutation = useAddCandidateEvidence({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetCandidateQueryKey(updated.id), updated);
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        setForm({ title: "", url: "", sourceType: "Selskapsnyhet", publishedAt: "", excerpt: "" });
        setDuplicateEvidenceUrl(null);
        setEvidenceError(null);
        toast({ title: "Kilde kontrollert", description: "URL-en er lagret, og systemet har vurdert relevansen på nytt." });
      },
      onError: (error) => {
        if (isDuplicateEvidenceError(error)) {
          setDuplicateEvidenceUrl(form.url.trim());
          setEvidenceError(null);
          toast({ title: "Kilden finnes allerede", description: "Den samme URL-en er allerede registrert for dette selskapet.", variant: "destructive" });
          return;
        }
        const message = getApiErrorMessage(error);
        setEvidenceError(message);
        toast({ title: "Kilden kunne ikke lagres", description: message, variant: "destructive" });
      },
    },
  });
  const sourceMutation = useCreateCandidateSource({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListCandidateSourcesQueryKey(id) });
        setSourceForm({ sourceType: "rss", label: "", url: "" });
        toast({ title: "Offisiell kilde lagt til", description: "Kilden blir kontrollert i neste overvåkningskjøring." });
      },
      onError: (error) => toast({ title: "Kilden kunne ikke lagres", description: getApiErrorMessage(error), variant: "destructive" }),
    },
  });
  const updateCandidateInCache = (updated: Candidate) => {
    queryClient.setQueryData(getGetCandidateQueryKey(updated.id), updated);
    queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
  };
  const relevanceMutation = useUpdateCandidateRelevance({
    mutation: {
      onSuccess: (updated) => {
        updateCandidateInCache(updated);
        setRelevanceChoice(null);
        setDecisionReason("");
        toast({ title: "Relevans lagret", description: "Den manuelle vurderingen overstyrer ikke kildehistorikken." });
      },
      onError: () => toast({ title: "Kunne ikke lagre relevans", variant: "destructive" }),
    },
  });
  const monitoringMutation = useUpdateCandidateMonitoring({
    mutation: {
      onSuccess: (updated) => {
        updateCandidateInCache(updated);
        setDecisionReason("");
        toast({ title: updated.monitoringStatus === "monitoring" ? "Lagt til i overvåkning" : "Tatt ut av overvåkning", description: "Snapshots og kilder er beholdt i hovedlisten." });
      },
      onError: () => toast({ title: "Kunne ikke oppdatere overvåkning", variant: "destructive" }),
    },
  });
  const crmEnrichmentMutation = useEnrichCandidateCrm({
    mutation: {
      onSuccess: (result) => {
        const updated = result.candidates.find((item) => item.id === id);
        if (updated) updateCandidateInCache(updated);
        toast({
          title: "CRM-grunnlag oppdatert",
          description: updated?.crmEnrichment
            ? crmEnrichmentMessage(updated.crmEnrichment.status)
            : "CRM-oppslaget ble gjennomført.",
        });
      },
      onError: () => toast({
        title: "CRM-grunnlaget kunne ikke oppdateres",
        description: "Ingen manuelle relevansvalg eller kildehistorikk er endret.",
        variant: "destructive",
      }),
    },
  });
  const eventMappingMutation = useStartEventMappingRun({
    mutation: {
      onSuccess: () => {
        setMappingRunning(true);
        toast({ title: "Kartlegging startet", description: "Systemet sjekker tilgjengelig offentlig informasjon for dette selskapet. Resultatet oppdateres automatisk her." });
      },
      onError: (error) => toast({
        title: "Kartleggingen kunne ikke startes",
        description: error instanceof Error ? error.message : "Prøv igjen senere.",
        variant: "destructive",
      }),
    },
  });
  useEffect(() => {
    if (!mappingRunning) return;
    const timeout = window.setTimeout(() => setMappingRunning(false), 20_000);
    return () => window.clearTimeout(timeout);
  }, [mappingRunning]);

  if (isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-64 w-full" /></div>;
  if (isError || !candidate) return <div className="p-6 text-destructive">Kandidaten kunne ikke lastes.</div>;

  return (
    <div className="h-full flex flex-col">
      <header className="min-h-[56px] border-b border-border bg-card px-6 py-3">
        <Link href="/candidates" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Tilbake til kandidater</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{candidate.companyName}</h1>
           <PriorityBadge score={candidate.priorityScore} />
           <RelevanceBadge status={candidate.relevanceStatus} />
           <Badge variant="outline">{candidate.relevanceSource === "manual" ? "Manuell overstyring" : `System · ${confidenceLabel(candidate.relevanceConfidence)}`}</Badge>
           <MonitoringBadge status={candidate.monitoringStatus} />
        </div>
      </header>
      <div className="flex-1 overflow-auto bg-background p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.5fr_0.8fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-primary" /> Hvorfor denne kandidaten</CardTitle><CardDescription>Prioriteringen er regelbasert. CRM er ikke brukt til å velge kandidaten.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                 {candidate.priorityReasons.map((reason) => <div key={reason} className="rounded-md border border-border bg-muted/40 p-3 text-sm">{reason}</div>)}
                <div className="grid gap-2 pt-2 text-sm sm:grid-cols-3">
                  <Meta label="Domene" value={candidate.domain ?? "Ikke oppgitt"} />
                  <Meta label="Bransje" value={candidate.industry ?? "Ikke oppgitt"} />
                  <Meta label="Ansatte" value={candidate.employees?.toLocaleString("nb-NO") ?? "Ikke oppgitt"} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-primary" /> Automatisk relevans</CardTitle><CardDescription>{candidate.relevanceSource === "manual" ? "Systemets kildegrunnlag er bevart, men statusen under er manuelt overstyrt." : "Systemforslaget kombinerer snapshots, sikre CRM-treff, verifiserte offentlige kilder og dokumenterte endringer."}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                 <div className="flex flex-wrap items-center gap-2"><RelevanceBadge status={candidate.relevanceStatus} /><Badge variant="outline">{confidenceLabel(candidate.relevanceConfidence)} sikkerhet</Badge>{candidate.lastAnalyzedAt ? <span className="text-xs text-muted-foreground">Sist beregnet {format(new Date(candidate.lastAnalyzedAt), "d. MMM yyyy HH:mm", { locale: nb })}</span> : null}</div>
                <p className="text-sm">{candidate.relevanceReason ?? "Ingen automatisk begrunnelse er lagret ennå."}</p>
                 <div className="grid gap-2 sm:grid-cols-2">{candidate.priorityReasons.slice(0, 4).map((reason) => <div key={reason} className="rounded-md border border-border bg-muted/40 p-3 text-sm">{reason}</div>)}</div>
                <Button variant="outline" onClick={() => eventMappingMutation.mutate({ data: { candidateIds: [candidate.id] } })} disabled={eventMappingMutation.isPending || mappingRunning}>
                  <FileSearch className={`mr-2 h-4 w-4 ${eventMappingMutation.isPending || mappingRunning ? "animate-pulse" : ""}`} />
                  {eventMappingMutation.isPending || mappingRunning ? "Kartlegger selskapet…" : "Kjør kartlegging for dette selskapet"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-primary" /> Manuell relevans og overvåkning</CardTitle><CardDescription>Hovedlisten beholder selskapet uansett valg. Et manuelt valg overstyrer systemforslaget, men ikke kildene.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="grid gap-1 text-sm font-medium">Relevans
                    <select value={relevanceChoice ?? (candidate.relevanceStatus === "insufficient_data" ? "possible" : candidate.relevanceStatus)} onChange={(event) => setRelevanceChoice(event.target.value as ManualRelevanceStatus)} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                      <option value="relevant">Relevant</option>
                      <option value="possible">Mulig relevant</option>
                      <option value="needs_review">Må vurderes</option>
                      <option value="not_relevant">Ikke relevant</option>
                    </select>
                  </label>
                  <Button onClick={() => relevanceMutation.mutate({ id: candidate.id, data: { relevanceStatus: relevanceChoice ?? (candidate.relevanceStatus === "insufficient_data" ? "possible" : candidate.relevanceStatus), reason: decisionReason || null } })} disabled={relevanceMutation.isPending}>Lagre relevans</Button>
                </div>
                <Textarea placeholder="Valgfri begrunnelse for ditt valg" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} />
                <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-medium">{candidate.monitoringStatus === "monitoring" ? "Dette selskapet overvåkes" : "Dette selskapet overvåkes ikke"}</p><p className="text-muted-foreground">{candidate.monitoringReason ?? "Du kan endre dette uten å slette historikk eller relevansvurdering."}</p></div>
                  <Button variant={candidate.monitoringStatus === "monitoring" ? "outline" : "default"} onClick={() => monitoringMutation.mutate({ id: candidate.id, data: { monitoringStatus: candidate.monitoringStatus === "monitoring" ? "not_monitoring" : "monitoring", reason: decisionReason || null } })} disabled={monitoringMutation.isPending}><Radio className="mr-2 h-4 w-4" />{candidate.monitoringStatus === "monitoring" ? "Trekk fra overvåkning" : "Legg til i overvåkning"}</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSearch className="h-4 w-4 text-primary" /> Kildesnapshots og observerte endringer</CardTitle><CardDescription>Snapshotene beholdes side om side. Nyere import overskriver ikke eldre observasjoner.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {candidate.changes.length ? candidate.changes.map((change, index) => <div key={`${change.kind}-${index}`} className="border-l-2 border-primary pl-3"><p className="text-sm font-medium">{change.label}</p><p className="text-sm text-muted-foreground">{change.detail}</p></div>) : <p className="text-sm text-muted-foreground">Ingen sammenlignbar endring ennå. Importer et nytt snapshot eller en relevant Sales Navigator-rolle.</p>}
                <div className="divide-y rounded-md border">
                  {candidate.snapshots.map((snapshot) => <div key={snapshot.id} className="p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{snapshot.sourceType.replace("_", " ")}</Badge><span>{format(new Date(snapshot.snapshotDate), "d. MMM yyyy", { locale: nb })}</span></div><p className="mt-1 text-muted-foreground">{snapshot.originalCompanyName}{snapshot.data.roleTitle ? ` — ${snapshot.data.roleTitle}` : ""}</p></div>)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4 text-primary" /> Offentlig dokumentasjon</CardTitle><CardDescription>Kilden kontrolleres ved lagring, og systemet vurderer relevansen automatisk etterpå.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                {candidate.evidence.map((evidence) => <a key={evidence.url} href={evidence.url} target="_blank" rel="noreferrer" className="block rounded-md border p-3 hover:border-primary"><div className="flex items-center justify-between gap-2"><span className="font-medium">{evidence.title}</span><Badge variant="outline" className="text-[10px]">URL kontrollert</Badge></div>{evidence.excerpt ? <p className="mt-2 text-sm text-muted-foreground italic">«{evidence.excerpt}»</p> : null}<p className="mt-2 text-xs text-muted-foreground">{evidence.sourceType} · {format(new Date(evidence.publishedAt), "d. MMM yyyy", { locale: nb })}</p></a>)}
                {duplicateEvidenceUrl ? <div role="alert" className="flex items-start gap-3 rounded-md border border-accent bg-accent/20 p-3 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" /><div className="min-w-0 flex-1"><p className="font-medium">Denne kilden er allerede registrert</p><p className="mt-1 text-muted-foreground">Vi sendte ikke inn kilden på nytt. Åpne den eksisterende kilden nedenfor, eller behold skjemaet hvis du vil rette opplysningene.</p><a href={duplicateEvidenceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline">Åpne eksisterende kilde <ExternalLink className="h-3 w-3" /></a></div><Button aria-label="Lukk duplikatmelding" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setDuplicateEvidenceUrl(null)}><X className="h-4 w-4" /></Button></div> : null}
                 {evidenceError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{evidenceError}</div> : null}
                <div className="grid gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
                    <p className="text-xs text-muted-foreground">Krav: tittel minst 5 tegn, offentlig HTTPS-URL, publiseringsdato og kildetype. Sitat er valgfritt.</p>
                   <label className="grid gap-1 text-sm font-medium">Kildetittel <Input placeholder="Kildetittel" required minLength={5} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                   <label className="grid gap-1 text-sm font-medium">HTTPS-URL <Input type="url" placeholder="https://…" required value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label>
                   <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-medium">Kildetype <Input placeholder="Kildetype" required minLength={1} value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })} /></label><label className="grid gap-1 text-sm font-medium">Publiseringsdato <Input aria-label="Publiseringsdato" type="date" required value={form.publishedAt} onChange={(event) => setForm({ ...form, publishedAt: event.target.value })} /></label></div>
                    <label className="grid gap-1 text-sm font-medium">Sitat <span className="font-normal text-muted-foreground">(valgfritt)</span><Textarea placeholder="Kort, relevant sitat fra kilden (valgfritt)" value={form.excerpt} onChange={(event) => setForm({ ...form, excerpt: event.target.value })} /></label>
                  <Button onClick={submitEvidence} disabled={evidenceMutation.isPending}>Kontroller og legg til kilde</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Radio className="h-4 w-4 text-primary" /> Offisielle RSS-/Atom-kilder</CardTitle><CardDescription>Legg inn selskapets feed fra presserom/nyheter. Den kan brukes både i engangskartlegging og ved eventuell senere overvåkning.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                {sources.data?.length ? <div className="space-y-2">{sources.data.map((source) => <div key={source.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{source.label}</p><Badge variant="outline">{source.sourceType.toUpperCase()}</Badge>{source.lastError ? <Badge variant="outline" className="border-destructive/40 text-destructive">Sist kildefeil</Badge> : null}</div><p className="mt-1 truncate text-xs text-muted-foreground">{source.url}</p>{source.lastError ? <p className="mt-2 text-xs text-destructive">{source.lastError}</p> : <p className="mt-2 text-xs text-muted-foreground">{source.lastCheckedAt ? `Sist kontrollert ${format(new Date(source.lastCheckedAt), "d. MMM yyyy HH:mm", { locale: nb })}` : "Ikke kontrollert ennå"}</p>}</div>)}</div> : <p className="text-sm text-muted-foreground">Ingen automatiske kilder er konfigurert ennå. Manuelle evidenskilder over blir ikke crawlet.</p>}
                <div className="grid gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
                  <div className="grid gap-3 sm:grid-cols-[140px_1fr]"><select value={sourceForm.sourceType} onChange={(event) => setSourceForm({ ...sourceForm, sourceType: event.target.value as "rss" | "atom" })} className="h-10 rounded-md border border-input bg-card px-3 text-sm"><option value="rss">RSS</option><option value="atom">Atom</option></select><Input placeholder="Kildenavn, f.eks. Hydro Newsroom" value={sourceForm.label} onChange={(event) => setSourceForm({ ...sourceForm, label: event.target.value })} /></div>
                  <Input placeholder="https://…/feed.xml" value={sourceForm.url} onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })} />
                  <Button onClick={() => sourceMutation.mutate({ id: candidate.id, data: sourceForm })} disabled={sourceMutation.isPending}>{sourceMutation.isPending ? "Lagrer kilde…" : "Legg til offisiell feed"}</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><DatabaseZap className="h-4 w-4 text-primary" /> CRM-kontekst</CardTitle><CardDescription>Leses kun fra CRM. Treffer gir kontekst og prioritet, men kan aldri fjerne selskapet fra hovedlisten.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {candidate.crmEnrichment ? <CrmEnrichmentSummary enrichment={candidate.crmEnrichment} /> : <p className="text-sm text-muted-foreground">CRM-grunnlaget er ikke oppdatert ennå.</p>}
                <Button className="w-full" variant="outline" onClick={() => crmEnrichmentMutation.mutate({ data: { candidateIds: [candidate.id] } })} disabled={crmEnrichmentMutation.isPending}><DatabaseZap className="mr-2 h-4 w-4" />{crmEnrichmentMutation.isPending ? "Oppdaterer CRM…" : "Oppdater CRM-grunnlag"}</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-primary" /> CRM-kontaktsøk</CardTitle><CardDescription>Manuelt oppslag for kontaktvalg. Dette endrer ikke vurderingen.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Søk navn eller e-post" value={crmQuery} onChange={(event) => setCrmQuery(event.target.value)} /></div>
                {!candidate.domain ? <p className="text-sm text-muted-foreground">Legg inn domene via import for å gjøre CRM-oppslag.</p> : null}
                {crm.isFetching ? <p className="text-sm text-muted-foreground">Søker i CRM…</p> : null}
                {crm.data?.map((contact) => <div key={contact.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{contact.name}</p><p className="text-muted-foreground">{contact.title}</p><p className="mt-1 text-xs text-muted-foreground">{contact.email ?? "Ingen e-post"}</p></div>)}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function isDuplicateEvidenceError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const apiError = error as { status?: unknown; response?: { status?: unknown } };
  return apiError.status === 409 || apiError.response?.status === 409;
}

function getApiErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const apiError = error as { data?: unknown; message?: unknown };
    if (apiError.data && typeof apiError.data === "object") {
      const serverError = (apiError.data as { error?: unknown }).error;
      if (typeof serverError === "string" && serverError.trim()) return serverError;
    }
    if (typeof apiError.message === "string" && apiError.message.trim()) return apiError.message;
  }
  return "Kilden kunne ikke kontrolleres. Prøv igjen.";
}

function validateEvidenceForm(form: { title: string; url: string; sourceType: string; publishedAt: string; excerpt: string }) {
  if (form.title.trim().length < 5) return "Kildetittel må være minst 5 tegn.";
  let url: URL;
  try {
    url = new URL(form.url.trim());
  } catch {
    return "Kilden må være en gyldig URL.";
  }
  if (url.protocol !== "https:") return "Kilden må bruke HTTPS.";
  if (!form.sourceType.trim()) return "Kildetype må fylles ut.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.publishedAt) || Number.isNaN(Date.parse(`${form.publishedAt}T00:00:00Z`))) {
    return "Publiseringsdato må fylles ut med en gyldig dato.";
  }
  if (form.excerpt.trim().length < 20) return "Sitatet må være minst 20 tegn.";
  return null;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function confidenceLabel(confidence: Candidate["relevanceConfidence"]) {
  return { high: "Høy", medium: "Middels", low: "Lav", insufficient: "Utilstrekkelig" }[confidence];
}

function crmEnrichmentMessage(status: NonNullable<Candidate["crmEnrichment"]>["status"]) {
  return {
    matched: "Sikkert CRM-treff er lagret som kildegrunnlag.",
    not_found: "Fant ingen sikker CRM-match. Kandidaten beholdes uendret i hovedlisten.",
    ambiguous: "Flere mulige CRM-treff ble funnet. Ingen ble slått sammen automatisk.",
    unavailable: "CRM var midlertidig utilgjengelig. Prøv igjen senere.",
  }[status];
}

function CrmEnrichmentSummary({ enrichment }: { enrichment: NonNullable<Candidate["crmEnrichment"]> }) {
  if (enrichment.status !== "matched") {
    return <div className="rounded-md border border-border bg-muted/40 p-3 text-sm"><p className="font-medium">{crmEnrichmentMessage(enrichment.status)}</p>{enrichment.availabilityMessage ? <p className="mt-1 text-muted-foreground">{enrichment.availabilityMessage}</p> : null}<p className="mt-2 text-xs text-muted-foreground">Kontrollert {format(new Date(enrichment.evaluatedAt), "d. MMM yyyy HH:mm", { locale: nb })}</p></div>;
  }
  const method = { organization_number: "organisasjonsnummer", domain: "domene", name: "eksakt selskapsnavn" }[enrichment.matchMethod ?? "name"];
  return <div className="space-y-3 text-sm">
    <div className="rounded-md border border-border bg-muted/40 p-3"><p className="font-medium">{enrichment.matchedCompanyName ?? "Sikkert CRM-treff"}</p><p className="mt-1 text-muted-foreground">Matchet via {method} · {enrichment.contactCount} kontakter</p>{enrichment.lastActivityAt ? <p className="mt-1 text-xs text-muted-foreground">Siste aktivitet {format(new Date(enrichment.lastActivityAt), "d. MMM yyyy", { locale: nb })}</p> : null}</div>
    {enrichment.relevantContacts.length ? <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relevante roller</p><div className="mt-2 space-y-2">{enrichment.relevantContacts.map((contact) => <div key={contact.id} className="rounded-md border p-2"><p className="font-medium">{contact.name}</p><p className="text-muted-foreground">{contact.title ?? contact.contactRole ?? "Rolle ikke oppgitt"}</p></div>)}</div></div> : null}
    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground"><span>{enrichment.lifecycleStages.length ? enrichment.lifecycleStages.join(", ") : "Ingen salgsfase"}</span><span>{enrichment.noteCount} CRM-notater</span></div>
  </div>;
}