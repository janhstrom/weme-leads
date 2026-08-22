import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Candidate,
  CandidateImportInput,
  CandidateSnapshotSourceType,
  getListCandidatesQueryKey,
  useCreateCandidateAnalysisBatch,
  useImportCandidateSnapshots,
  useListCandidates,
  useUpdateCandidateMonitoring,
} from "@workspace/api-client-react";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";
import { Button } from "@workspace/weme-earth-tones-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Input } from "@workspace/weme-earth-tones-system/components/ui/input";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { useToast } from "@workspace/weme-earth-tones-system/hooks/use-toast";
import { Building2, ChevronRight, Eye, FileUp, ListChecks, Radio, Search, Sparkles, UsersRound } from "lucide-react";

type SourceType = CandidateSnapshotSourceType;
type ListView = "universe" | "monitoring" | "review";
type WorkScope = "universe" | "relevant" | "monitoring";

function rowValue(row: Record<string, string>, aliases: string[]) {
  const normalized = Object.entries(row).find(([key]) => aliases.includes(key.toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]/g, "")));
  return normalized?.[1]?.trim() || undefined;
}

function parseEmployeeCount(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^\d-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitCsvLine(line: string, separator: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === separator && !quoted) {
      result.push(current.trim());
      current = "";
    } else current += character;
  }
  result.push(current.trim());
  return result;
}

function parseCandidateCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV-filen må ha en overskriftsrad og minst én data-rad.");
  const separator = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const headers = splitCsvLine(lines[0], separator);
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line, separator);
    const fields = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const companyName = rowValue(fields, ["company", "companyname", "account", "selskap", "selskapsnavn", "firmanavn", "foretaksnavn"]);
    if (!companyName) throw new Error(`Rad ${index + 2} mangler selskapsnavn.`);
    return {
      sourceRowId: String(index + 2),
      companyName,
      organizationNumber: rowValue(fields, ["orgnr", "organisasjonsnummer", "organizationnumber", "companyid"]),
      domain: rowValue(fields, ["domain", "website", "web", "nettside"]),
      industry: rowValue(fields, ["industry", "bransje"]),
      employees: parseEmployeeCount(rowValue(fields, ["employees", "employee", "ansatte", "antallansatte", "headcount"])),
      revenue: rowValue(fields, ["revenue", "omsetning", "turnover"]),
      owner: rowValue(fields, ["owner", "eier", "ownership"]),
      personName: rowValue(fields, ["fullname", "name", "person", "kontakt"]),
      roleTitle: rowValue(fields, ["title", "jobtitle", "rolle", "stilling"]),
      profileUrl: rowValue(fields, ["profileurl", "linkedinurl", "linkedin"]),
      fields,
    };
  });
}

export default function CandidatesPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ListView>("universe");
  const [workScope, setWorkScope] = useState<WorkScope>("monitoring");
  const [sourceType, setSourceType] = useState<SourceType>("dnb_bisnode");
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: candidates, isLoading } = useListCandidates();

  const visibleCandidates = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("nb-NO");
    return (candidates ?? []).filter((candidate) => {
      const inView =
        view === "universe" ||
        (view === "monitoring" && candidate.monitoringStatus === "monitoring") ||
        (view === "review" && (candidate.relevanceStatus === "needs_review" || candidate.matchStatus === "needs_review"));
      return inView && (!needle || [candidate.companyName, candidate.domain, candidate.industry].filter(Boolean).join(" ").toLocaleLowerCase("nb-NO").includes(needle));
    });
  }, [candidates, search, view]);

  const importMutation = useImportCandidateSnapshots({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        toast({ title: "Hovedlisten er oppdatert", description: `${result.created} nye selskaper, ${result.matched} matchet og ${result.needsReview} trenger avklaring.` });
      },
      onError: (error) => toast({ title: "Importen feilet", description: error instanceof Error ? error.message : "Kontroller CSV-formatet.", variant: "destructive" }),
    },
  });
  const monitoringMutation = useUpdateCandidateMonitoring({
    mutation: {
      onSuccess: (candidate) => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        toast({ title: candidate.monitoringStatus === "monitoring" ? "Lagt til i overvåkning" : "Tatt ut av overvåkning", description: "Selskapets kildehistorikk er beholdt." });
      },
      onError: () => toast({ title: "Kunne ikke oppdatere overvåkning", variant: "destructive" }),
    },
  });
  const batchMutation = useCreateCandidateAnalysisBatch({
    mutation: {
      onSuccess: (batch) => toast({ title: "Gjennomgangsliste klar", description: `${batch.selectedCount} selskaper er valgt fra ${scopeLabel(workScope)}. Dette er en arbeidsliste, ikke en ny kildeimport.` }),
      onError: () => toast({ title: "Kunne ikke opprette gjennomgangsliste", variant: "destructive" }),
    },
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const payload: CandidateImportInput = { sourceType, snapshotDate, records: parseCandidateCsv(await file.text()) };
      importMutation.mutate({ data: payload });
    } catch (error) {
      toast({ title: "CSV-filen kunne ikke leses", description: error instanceof Error ? error.message : "Kontroller filen.", variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const monitoredCount = candidates?.filter((candidate) => candidate.monitoringStatus === "monitoring").length ?? 0;
  const reviewCount = candidates?.filter((candidate) => candidate.relevanceStatus === "needs_review" || candidate.matchStatus === "needs_review").length ?? 0;

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 min-h-[56px] border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="font-semibold text-lg">Hovedliste og overvåkning</h1>
          <p className="text-xs text-muted-foreground">Alle selskaper beholdes i hovedlisten. Overvåkning er et separat og reversibelt valg.</p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6 bg-background">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Stat label="I hovedlisten" value={candidates?.length ?? 0} icon={<Building2 className="h-4 w-4 text-primary" />} />
            <Stat label="Overvåkes" value={monitoredCount} icon={<Radio className="h-4 w-4 text-accent" />} />
            <Stat label="Må vurderes" value={reviewCount} icon={<Eye className="h-4 w-4 text-destructive" />} />
          </div>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Slik brukes selskapene</CardTitle>
              <CardDescription>Importerte selskaper blir vurdert fra firmadata, roller og endringer. Du bestemmer deretter hvilke relevante selskaper som skal overvåkes.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-3">
              <SourceRole title="1. Hovedliste" description="Alle importerte selskaper beholdes og får en relevansvurdering." />
              <SourceRole title="2. Relevans" description="Systemet foreslår status med begrunnelse. Du kan endre den på selskapsdetaljen." />
              <SourceRole title="3. Overvåkning" description="Bare selskaper du velger å overvåke skal følges for nye signaler." />
            </CardContent>
          </Card>

          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><FileUp className="h-4 w-4 text-muted-foreground" /> Har du et nytt snapshot? Oppdater hovedlisten ved behov.</span>
              <span className="text-xs text-muted-foreground group-open:hidden">Valgfritt</span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">Skjul</span>
            </summary>
            <div className="border-t border-border p-4">
              <p className="mb-3 max-w-3xl text-sm text-muted-foreground">Dette legger nye observasjoner oppå eksisterende historikk. Det sletter ikke selskaper eller valg i overvåkningslisten.</p>
              <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
                <label className="grid gap-1 text-sm font-medium">Kilde
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                    <option value="dnb_bisnode">D&B/Bisnode</option><option value="sales_navigator">Sales Navigator</option><option value="manual">Manuelt utdrag</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium">Snapshot-dato<Input type="date" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} /></label>
                <input ref={fileRef} className="hidden" type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} />
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importMutation.isPending}><FileUp className="mr-2 h-4 w-4" /> {importMutation.isPending ? "Oppdaterer…" : "Velg nytt snapshot"}</Button>
              </div>
            </div>
          </details>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {([
                ["universe", "Hovedliste", candidates?.length ?? 0],
                ["monitoring", "Overvåkes", monitoredCount],
                ["review", "Til vurdering", reviewCount],
              ] as const).map(([nextView, label, count]) => (
                <Button key={nextView} size="sm" variant={view === nextView ? "default" : "outline"} onClick={() => setView(nextView)}>{label} ({count})</Button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Søk i hovedlisten…" /></div>
              <select value={workScope} onChange={(event) => setWorkScope(event.target.value as WorkScope)} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                <option value="monitoring">Overvåkningslisten</option><option value="relevant">Alle relevante</option><option value="universe">Hele hovedlisten</option>
              </select>
              <Button variant="outline" onClick={() => batchMutation.mutate({ data: { scope: workScope } })} disabled={batchMutation.isPending}><ListChecks className="mr-2 h-4 w-4" /> {batchMutation.isPending ? "Oppretter…" : "Opprett gjennomgangsliste"}</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Gjennomgangslisten velger selskaper fra valget ditt. Relevans beregnes når kilde-snapshots oppdateres; CRM brukes aldri til å fjerne selskaper.</p>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {isLoading ? <div className="space-y-3 p-6">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-24 w-full" />)}</div> : visibleCandidates.length ? (
              <div className="divide-y divide-border">
                {visibleCandidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} pending={monitoringMutation.isPending} onToggleMonitoring={() => monitoringMutation.mutate({ id: candidate.id, data: { monitoringStatus: candidate.monitoringStatus === "monitoring" ? "not_monitoring" : "monitoring" } })} />)}
              </div>
            ) : <div className="p-12 text-center text-muted-foreground"><UsersRound className="mx-auto mb-3 h-10 w-10 text-primary" /><p className="font-medium text-foreground">Ingen selskaper i dette utvalget</p><p className="mt-1 text-sm">Selskaper som tas ut av overvåkning er fortsatt tilgjengelige i hovedlisten.</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function scopeLabel(scope: WorkScope) {
  return { universe: "hele hovedlisten", relevant: "alle relevante selskaper", monitoring: "overvåkningslisten" }[scope];
}

function SourceRole({ title, description }: { title: string; description: string }) {
  return <div className="rounded-md border border-primary/15 bg-card/70 p-3"><p className="font-semibold">{title}</p><p className="mt-1 text-muted-foreground">{description}</p></div>;
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Card><CardContent className="p-4"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span>{icon}</div><div className="mt-1 text-2xl font-bold">{value}</div></CardContent></Card>;
}

function CandidateRow({ candidate, pending, onToggleMonitoring }: { candidate: Candidate; pending: boolean; onToggleMonitoring: () => void }) {
  return <div className="flex items-center gap-4 p-4 sm:px-6">
    <Link href={`/candidates/${candidate.id}`} className="group min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold group-hover:text-primary">{candidate.companyName}</span><RelevanceBadge status={candidate.relevanceStatus} /><MonitoringBadge status={candidate.monitoringStatus} /></div>
      <p className="mt-1 text-sm text-muted-foreground">{candidate.relevanceReason ?? candidate.priorityReasons[0]}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{candidate.snapshots.length} snapshots</span>{candidate.employees ? <span>{candidate.employees.toLocaleString("nb-NO")} ansatte</span> : null}<span>{candidate.evidence.length} offentlige kilder</span></div>
    </Link>
    <Button size="sm" variant={candidate.monitoringStatus === "monitoring" ? "outline" : "default"} onClick={onToggleMonitoring} disabled={pending}>{candidate.monitoringStatus === "monitoring" ? "Trekk fra" : "Overvåk"}</Button>
    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
  </div>;
}

export function RelevanceBadge({ status }: { status: Candidate["relevanceStatus"] }) {
  const labels = { relevant: "Relevant", possible: "Mulig relevant", not_relevant: "Ikke relevant", needs_review: "Må vurderes" };
  const styles = { relevant: "bg-primary text-primary-foreground", possible: "bg-accent text-accent-foreground", not_relevant: "bg-muted text-muted-foreground", needs_review: "bg-destructive text-destructive-foreground" };
  return <Badge variant="outline" className={`${styles[status]} border-transparent text-[10px] uppercase`}>{labels[status]}</Badge>;
}

export function MonitoringBadge({ status }: { status: Candidate["monitoringStatus"] }) {
  return <Badge variant="outline" className={`${status === "monitoring" ? "border-primary/30 text-primary" : "border-muted text-muted-foreground"} text-[10px] uppercase`}>{status === "monitoring" ? "Overvåkes" : "Ikke overvåket"}</Badge>;
}