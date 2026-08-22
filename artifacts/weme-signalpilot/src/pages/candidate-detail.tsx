import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { nb } from "date-fns/locale";
import {
  Candidate,
  getSearchCrmContactsQueryKey,
  getGetCandidateQueryKey,
  getListCandidatesQueryKey,
  useAddCandidateEvidence,
  useGetCandidate,
  useSearchCrmContacts,
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
import { AlertCircle, ArrowLeft, Building2, Eye, ExternalLink, FileSearch, Link2, Radio, Search, UserRound, X } from "lucide-react";

export default function CandidateDetailPage() {
  const [, params] = useRoute("/candidates/:id");
  const id = Number(params?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: candidate, isLoading, isError } = useGetCandidate(id);
  const [crmQuery, setCrmQuery] = useState("");
  const [form, setForm] = useState({ title: "", url: "", sourceType: "Selskapsnyhet", publishedAt: "", excerpt: "" });
  const [relevanceChoice, setRelevanceChoice] = useState<Candidate["relevanceStatus"] | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [duplicateEvidenceUrl, setDuplicateEvidenceUrl] = useState<string | null>(null);
  const crmSearchParams = { query: crmQuery, companyDomain: candidate?.domain ?? "" };
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
        toast({ title: "Kilde kontrollert", description: "Den konkrete URL-en er lagret. Relevansen må fortsatt vurderes manuelt." });
      },
      onError: (error) => {
        if (isDuplicateEvidenceError(error)) {
          setDuplicateEvidenceUrl(form.url.trim());
          toast({ title: "Kilden finnes allerede", description: "Den samme URL-en er allerede registrert for dette selskapet.", variant: "destructive" });
          return;
        }
        toast({ title: "Kilden kunne ikke lagres", description: "Kontroller feltene og at URL-en er tilgjengelig.", variant: "destructive" });
      },
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

  if (isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-64 w-full" /></div>;
  if (isError || !candidate) return <div className="p-6 text-destructive">Kandidaten kunne ikke lastes.</div>;

  return (
    <div className="h-full flex flex-col">
      <header className="min-h-[56px] border-b border-border bg-card px-6 py-3">
        <Link href="/candidates" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Tilbake til kandidater</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{candidate.companyName}</h1>
          <Badge variant="outline">{candidate.priorityScore} prioritetspoeng</Badge>
          <Badge variant="secondary">{candidate.relevanceStatus.replace("_", " ")}</Badge>
          <Badge variant={candidate.monitoringStatus === "monitoring" ? "default" : "outline"}>{candidate.monitoringStatus === "monitoring" ? "Overvåkes" : "Ikke overvåket"}</Badge>
        </div>
      </header>
      <div className="flex-1 overflow-auto bg-background p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.5fr_0.8fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-primary" /> Hvorfor denne kandidaten</CardTitle><CardDescription>Prioriteringen er regelbasert. CRM er ikke brukt til å velge kandidaten.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {candidate.priorityReasons.map((reason) => <div key={reason} className="rounded-md bg-secondary/60 p-3 text-sm">{reason}</div>)}
                <div className="grid gap-2 pt-2 text-sm sm:grid-cols-3">
                  <Meta label="Domene" value={candidate.domain ?? "Ikke oppgitt"} />
                  <Meta label="Bransje" value={candidate.industry ?? "Ikke oppgitt"} />
                  <Meta label="Ansatte" value={candidate.employees?.toLocaleString("nb-NO") ?? "Ikke oppgitt"} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-primary" /> Relevans og overvåkning</CardTitle><CardDescription>Hovedlisten beholder selskapet uansett valg. Du styrer om det er relevant og om det skal overvåkes.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="grid gap-1 text-sm font-medium">Relevans
                    <select value={relevanceChoice ?? candidate.relevanceStatus} onChange={(event) => setRelevanceChoice(event.target.value as Candidate["relevanceStatus"])} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                      <option value="relevant">Relevant</option>
                      <option value="possible">Mulig relevant</option>
                      <option value="needs_review">Må vurderes</option>
                      <option value="not_relevant">Ikke relevant</option>
                    </select>
                  </label>
                  <Button onClick={() => relevanceMutation.mutate({ id: candidate.id, data: { relevanceStatus: relevanceChoice ?? candidate.relevanceStatus, reason: decisionReason || null } })} disabled={relevanceMutation.isPending}>Lagre relevans</Button>
                </div>
                <Textarea placeholder="Valgfri begrunnelse for ditt valg" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} />
                <div className="flex flex-col gap-2 rounded-md bg-secondary/60 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
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
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4 text-primary" /> Offentlig dokumentasjon</CardTitle><CardDescription>En kandidat blir ikke et aktivt signal før en konkret offentlig kilde er registrert og vurdert.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                {candidate.evidence.map((evidence) => <a key={evidence.url} href={evidence.url} target="_blank" rel="noreferrer" className="block rounded-md border p-3 hover:border-primary"><div className="flex items-center justify-between gap-2"><span className="font-medium">{evidence.title}</span><Badge variant="outline" className="text-[10px]">URL kontrollert</Badge></div><p className="mt-2 text-sm text-muted-foreground italic">«{evidence.excerpt}»</p><p className="mt-2 text-xs text-muted-foreground">{evidence.sourceType} · {format(new Date(evidence.publishedAt), "d. MMM yyyy", { locale: nb })}</p></a>)}
                {duplicateEvidenceUrl ? <div role="alert" className="flex items-start gap-3 rounded-md border border-accent bg-accent/20 p-3 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" /><div className="min-w-0 flex-1"><p className="font-medium">Denne kilden er allerede registrert</p><p className="mt-1 text-muted-foreground">Vi sendte ikke inn kilden på nytt. Åpne den eksisterende kilden nedenfor, eller behold skjemaet hvis du vil rette opplysningene.</p><a href={duplicateEvidenceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline">Åpne eksisterende kilde <ExternalLink className="h-3 w-3" /></a></div><Button aria-label="Lukk duplikatmelding" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setDuplicateEvidenceUrl(null)}><X className="h-4 w-4" /></Button></div> : null}
                <div className="grid gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
                  <Input placeholder="Kildetittel" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                  <Input placeholder="https://…" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
                  <div className="grid gap-3 sm:grid-cols-2"><Input placeholder="Kildetype" value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value })} /><Input type="date" value={form.publishedAt} onChange={(event) => setForm({ ...form, publishedAt: event.target.value })} /></div>
                  <Textarea placeholder="Kort, relevant sitat fra kilden" value={form.excerpt} onChange={(event) => setForm({ ...form, excerpt: event.target.value })} />
                  <Button onClick={() => evidenceMutation.mutate({ id: candidate.id, data: form })} disabled={evidenceMutation.isPending}>Kontroller og legg til kilde</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-primary" /> CRM-oppslag</CardTitle><CardDescription>Kun kontekst og kontaktvalg. Gamle CRM-data begrenser ikke denne kandidaten.</CardDescription></CardHeader>
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

function Meta({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}