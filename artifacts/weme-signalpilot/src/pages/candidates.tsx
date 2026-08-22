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
} from "@workspace/api-client-react";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";
import { Button } from "@workspace/weme-earth-tones-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Input } from "@workspace/weme-earth-tones-system/components/ui/input";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { useToast } from "@workspace/weme-earth-tones-system/hooks/use-toast";
import { Building2, CalendarClock, ChevronRight, FileUp, Filter, Search, Sparkles, UsersRound } from "lucide-react";

type SourceType = CandidateSnapshotSourceType;

function rowValue(row: Record<string, string>, aliases: string[]) {
  const normalized = Object.entries(row).find(([key]) => aliases.includes(key.toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]/g, "")));
  return normalized?.[1]?.trim() || undefined;
}

function parseEmployeeCount(value: string | undefined) {
  if (!value) return undefined;
  const digits = value.replace(/[^\d-]/g, "");
  const parsed = Number(digits);
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
      } else {
        quoted = !quoted;
      }
    } else if (character === separator && !quoted) {
      result.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCandidateCsv(text: string, sourceType: SourceType) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV-filen må ha en overskriftsrad og minst én data-rad.");
  const separator = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const headers = splitCsvLine(lines[0], separator);
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line, separator);
    const fields = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const companyName = rowValue(fields, ["company", "companyname", "companyname", "account", "selskap", "selskapsnavn", "firmanavn", "foretaksnavn"]);
    if (!companyName) throw new Error(`Rad ${index + 2} mangler selskapsnavn. Bruk for eksempel «Company», «Account» eller «Selskapsnavn».`);
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
  const [sourceType, setSourceType] = useState<SourceType>("dnb_bisnode");
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [batchSize, setBatchSize] = useState("25");
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useMemo(() => search ? { search } : undefined, [search]);
  const { data: candidates, isLoading } = useListCandidates(query);
  const importMutation = useImportCandidateSnapshots({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        toast({
          title: "Snapshot importert",
          description: `${result.created} nye, ${result.matched} matchet og ${result.needsReview} trenger avklaring.`,
        });
      },
      onError: (error) => toast({ title: "Importen feilet", description: error instanceof Error ? error.message : "Kontroller CSV-formatet.", variant: "destructive" }),
    },
  });
  const batchMutation = useCreateCandidateAnalysisBatch({
    mutation: {
      onSuccess: (batch) => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        toast({ title: "Analysebatch klar", description: `${batch.selectedCount} kandidater er valgt. CRM er ikke brukt som filter.` });
      },
      onError: () => toast({ title: "Kunne ikke lage analysebatch", variant: "destructive" }),
    },
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const records = parseCandidateCsv(await file.text(), sourceType);
      const payload: CandidateImportInput = { sourceType, snapshotDate, records };
      importMutation.mutate({ data: payload });
    } catch (error) {
      toast({ title: "CSV-filen kunne ikke leses", description: error instanceof Error ? error.message : "Kontroller filen.", variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 min-h-[56px] border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="font-semibold text-lg">Kandidatunivers</h1>
          <p className="text-xs text-muted-foreground">Firmadata og roller velger hvem som undersøkes — CRM er bare oppslag.</p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6 bg-background">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Stat label="Kandidater" value={candidates?.length ?? 0} icon={<Building2 className="h-4 w-4 text-primary" />} />
            <Stat label="Klar for analyse" value={candidates?.filter((candidate) => candidate.priorityScore >= 25).length ?? 0} icon={<Sparkles className="h-4 w-4 text-accent" />} />
            <Stat label="Usikre matcher" value={candidates?.filter((candidate) => candidate.matchStatus === "needs_review").length ?? 0} icon={<Filter className="h-4 w-4 text-destructive" />} />
          </div>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Dette er kildegrunnlaget vi overvåker nå</CardTitle>
              <CardDescription>Pilotkildene du allerede har gitt er behandlet og ligger fast som grunnlag for nye vurderinger. Du trenger ikke laste opp filene på nytt.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-3">
              <SourceRole title="D&B/Bisnode" description="Firmaprofil og endringer over tid." />
              <SourceRole title="Sales Navigator" description="Personer, roller og organisatoriske spor." />
              <SourceRole title="CRM og åpne kilder" description="CRM gir historikk og kontaktvalg. Offentlige kilder dokumenterer konkrete signaler." />
            </CardContent>
          </Card>

          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><FileUp className="h-4 w-4 text-muted-foreground" /> Har du et nytt snapshot? Importer kun ved behov.</span>
              <span className="text-xs text-muted-foreground group-open:hidden">Valgfritt</span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">Skjul</span>
            </summary>
            <div className="border-t border-border p-4">
              <p className="mb-3 max-w-3xl text-sm text-muted-foreground">Dette er ikke nødvendig for pilotgrunnlaget. Bruk dette bare hvis du unntaksvis får en ny D&B/Bisnode- eller Sales Navigator-eksport. Eldre snapshots beholdes.</p>
              <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
                <label className="grid gap-1 text-sm font-medium">
                  Kilde
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                    <option value="dnb_bisnode">D&B/Bisnode</option>
                    <option value="sales_navigator">Sales Navigator</option>
                    <option value="manual">Manuelt utdrag</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Snapshot-dato
                  <Input type="date" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} />
                </label>
                <input ref={fileRef} className="hidden" type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} />
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importMutation.isPending}>
                  <FileUp className="mr-2 h-4 w-4" /> {importMutation.isPending ? "Importerer…" : "Velg ny CSV"}
                </Button>
              </div>
            </div>
          </details>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Søk i kandidater…" />
            </div>
            <div className="flex items-center gap-2">
              <Input className="w-20" type="number" min="1" max="100" value={batchSize} onChange={(event) => setBatchSize(event.target.value)} aria-label="Antall kandidater i batch" />
              <Button variant="outline" onClick={() => batchMutation.mutate({ data: { limit: Math.max(1, Math.min(100, Number(batchSize) || 25)) } })} disabled={batchMutation.isPending}>
                <CalendarClock className="mr-2 h-4 w-4" /> {batchMutation.isPending ? "Velger…" : "Lag analysebatch"}
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {isLoading ? (
              <div className="space-y-3 p-6">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-24 w-full" />)}</div>
            ) : candidates?.length ? (
              <div className="divide-y divide-border">
                {candidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} />)}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground">
                <UsersRound className="mx-auto mb-3 h-10 w-10 text-primary" />
                <p className="font-medium text-foreground">Ingen kandidater ennå</p>
                <p className="mt-1 text-sm">Pilotgrunnlaget er allerede klart. Nye filer trenger du bare å importere hvis du senere får et nytt snapshot.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceRole({ title, description }: { title: string; description: string }) {
  return <div className="rounded-md border border-primary/15 bg-card/70 p-3"><p className="font-semibold">{title}</p><p className="mt-1 text-muted-foreground">{description}</p></div>;
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Card><CardContent className="p-4"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span>{icon}</div><div className="mt-1 text-2xl font-bold">{value}</div></CardContent></Card>;
}

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const status = {
    exact: "Eksakt match",
    domain_match: "Domene-match",
    name_match: "Navne-match",
    needs_review: "Avklar match",
    new: "Ny kandidat",
  }[candidate.matchStatus];
  return (
    <Link href={`/candidates/${candidate.id}`} className="group block p-4 hover:bg-secondary/30 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-semibold group-hover:text-primary">{candidate.companyName}</span>
            <Badge variant="secondary" className="text-[10px] uppercase">{status}</Badge>
            <Badge variant="outline" className="text-[10px]">{candidate.priorityScore} poeng</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{candidate.priorityReasons[0]}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{candidate.snapshots.length} snapshots</span>
            {candidate.employees ? <span>{candidate.employees.toLocaleString("nb-NO")} ansatte</span> : null}
            <span>{candidate.evidence.length} offentlige kilder</span>
          </div>
        </div>
        <ChevronRight className="mt-2 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
      </div>
    </Link>
  );
}