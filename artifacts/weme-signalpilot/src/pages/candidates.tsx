import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { read, utils } from "xlsx";
import {
  Candidate,
  CandidateImportInput,
  CandidateSnapshotSourceType,
  getListCandidatesQueryKey,
  useBulkUpdateCandidateRelevance,
  useCreateCandidateAnalysisBatch,
  useCorrectCandidateSnapshotDate,
  useEnrichCandidateCrm,
  useImportCandidateSnapshots,
  useListCandidates,
  useUpdateCandidateMonitoring,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/weme-earth-tones-system/components/ui/alert-dialog";
import { Button } from "@workspace/weme-earth-tones-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Checkbox } from "@workspace/weme-earth-tones-system/components/ui/checkbox";
import { Input } from "@workspace/weme-earth-tones-system/components/ui/input";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { useToast } from "@workspace/weme-earth-tones-system/hooks/use-toast";
import { ArrowDownAZ, ArrowUpDown, CheckCheck, ChevronRight, CircleAlert, CircleCheck, DatabaseZap, FileUp, ListChecks, ListFilter, Radio, Search, Sparkles, UsersRound } from "lucide-react";
import { MonitoringBadge, PriorityBadge, RelevanceBadge, relevanceLabel } from "@/components/status-badges";

type SourceType = CandidateSnapshotSourceType;
type ListView = "universe" | "follow_up" | "monitoring" | "review" | "crm_review";
type WorkScope = "universe" | "relevant" | "monitoring";
type ManualRelevanceStatus = Exclude<Candidate["relevanceStatus"], "insufficient_data">;
type PriorityFilter = "all" | "high" | "some" | "none";
type CandidateSort = "priority_desc" | "priority_asc" | "company_asc";

function rowValue(row: Record<string, string>, aliases: string[]) {
  const normalized = Object.entries(row).find(([key]) => aliases.includes(key.toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]/g, "")));
  return normalized?.[1]?.trim() || undefined;
}

const companyHeaderAliases = ["company", "companyname", "account", "selskap", "selskapsnavn", "firmanavn", "foretaksnavn", "bedriftsnavn", "kundenavn", "navn"];

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

function parseCandidateRows(rows: Array<Record<string, unknown>>, firstDataRow = 2) {
  if (!rows.length) throw new Error("Filen må ha en overskriftsrad og minst én data-rad.");
  return rows.map((row, index) => {
    const fields = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim(),
      ]),
    );
    const companyName = rowValue(fields, companyHeaderAliases);
    if (!companyName) throw new Error(`Rad ${firstDataRow + index} mangler selskapsnavn.`);
    return {
      sourceRowId: String(index + 2),
      companyName,
      organizationNumber: rowValue(fields, ["orgnr", "organisasjonsnummer", "organizationnumber", "companyid"]),
      domain: rowValue(fields, ["domain", "website", "web", "nettside", "companydomainname", "companydomain", "companywebsite"]),
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

function parseCandidateCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV-filen må ha en overskriftsrad og minst én data-rad.");
  const separator = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const headers = splitCsvLine(lines[0], separator);
  return parseCandidateRows(lines.slice(1).map((line) => {
    const values = splitCsvLine(line, separator);
    return Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
  }));
}

function parseCandidateWorkbook(fileContents: ArrayBuffer) {
  const workbook = read(fileContents, { type: "array", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("Excel-filen har ingen ark å importere.");

  const sheetCandidates = workbook.SheetNames.flatMap((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false });
    const headerIndex = rows.findIndex((row) =>
      row.some((cell) => companyHeaderAliases.includes(
        String(cell).toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]/g, ""),
      )),
    );
    if (headerIndex < 0) return [];

    const headers = rows[headerIndex].map((header) => String(header ?? "").trim());
    const dataRows = rows.slice(headerIndex + 1)
      .filter((row) => row.some((cell) => String(cell ?? "").trim()))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
    const populatedCompanyRows = dataRows.filter((row) => {
      const fields = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, String(value ?? "").trim()]),
      );
      return Boolean(rowValue(fields, companyHeaderAliases));
    }).length;

    return [{ sheetIndex, headerIndex, dataRows, populatedCompanyRows }];
  });

  if (!sheetCandidates.length) throw new Error("Fant ikke en kolonne for selskapsnavn i Excel-arbeidsboken.");
  const selectedSheet = sheetCandidates
    .sort((a, b) => b.populatedCompanyRows - a.populatedCompanyRows || a.sheetIndex - b.sheetIndex)[0];
  if (!selectedSheet.populatedCompanyRows) {
    throw new Error("Fant en mulig selskapskolonne, men ingen selskapsnavn i Excel-arbeidsboken.");
  }
  return parseCandidateRows(selectedSheet.dataRows, selectedSheet.headerIndex + 2);
}

async function parseCandidateFile(file: File) {
  const filename = file.name.toLocaleLowerCase("nb-NO");
  if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
    return parseCandidateWorkbook(await file.arrayBuffer());
  }
  if (filename.endsWith(".csv") || file.type === "text/csv") {
    return parseCandidateCsv(await file.text());
  }
  throw new Error("Velg en CSV- eller Excel-fil (.xlsx).");
}

function importErrorMessage(error: unknown) {
  const apiError = error as { status?: unknown; response?: { status?: unknown } };
  if (apiError?.status === 413 || apiError?.response?.status === 413) {
    return "Filen er fortsatt for stor til å behandles. Prøv å dele arket i mindre utdrag, eller fjern unødvendige kolonner.";
  }
  if (apiError?.status || apiError?.response?.status) {
    return "Kunne ikke oppdatere hovedlisten. Kontroller at kilde, snapshot-dato og kolonner er gyldige.";
  }
  return error instanceof Error ? error.message : "Kontroller CSV- eller Excel-filen.";
}

export default function CandidatesPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ListView>(() => new URLSearchParams(window.location.search).get("view") === "crm-review" ? "crm_review" : "universe");
  const [workScope, setWorkScope] = useState<WorkScope>("monitoring");
  const [sourceType, setSourceType] = useState<SourceType>("dnb_bisnode");
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isImporting, setIsImporting] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [bulkRelevanceStatus, setBulkRelevanceStatus] = useState<ManualRelevanceStatus>("possible");
  const [bulkReason, setBulkReason] = useState("");
  const [confirmBulkDecision, setConfirmBulkDecision] = useState(false);
  const [confirmDateCorrection, setConfirmDateCorrection] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [candidateSort, setCandidateSort] = useState<CandidateSort>("priority_desc");
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: candidates, isLoading } = useListCandidates();

  const visibleCandidates = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("nb-NO");
    const filteredCandidates = (candidates ?? []).filter((candidate) => {
      const inView =
        view === "universe" ||
        (view === "follow_up" && candidate.relevanceStatus === "relevant" && candidate.monitoringStatus !== "monitoring") ||
        (view === "monitoring" && candidate.monitoringStatus === "monitoring") ||
         (view === "review" && isInvestigationCandidate(candidate)) ||
         (view === "crm_review" && ["not_found", "ambiguous", "unavailable"].includes(candidate.crmEnrichment?.status ?? ""));
      const inPriorityFilter =
        priorityFilter === "all" ||
        (priorityFilter === "high" && candidate.priorityScore >= 25) ||
        (priorityFilter === "some" && candidate.priorityScore > 0 && candidate.priorityScore < 25) ||
        (priorityFilter === "none" && candidate.priorityScore <= 0);
      return inView && inPriorityFilter && (!needle || [candidate.companyName, candidate.domain, candidate.industry].filter(Boolean).join(" ").toLocaleLowerCase("nb-NO").includes(needle));
    });

    return [...filteredCandidates].sort((a, b) => {
      if (candidateSort === "company_asc") {
        return a.companyName.localeCompare(b.companyName, "nb-NO");
      }
      const scoreDifference = candidateSort === "priority_asc"
        ? a.priorityScore - b.priorityScore
        : b.priorityScore - a.priorityScore;
      return scoreDifference || a.companyName.localeCompare(b.companyName, "nb-NO");
    });
  }, [candidates, candidateSort, priorityFilter, search, view]);

  const importMutation = useImportCandidateSnapshots({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
      },
      onError: () => undefined,
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
  const dateCorrectionMutation = useCorrectCandidateSnapshotDate({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        setConfirmDateCorrection(false);
        if (result.updatedCount === 0) {
          toast({ title: "Fant ingen snapshot å rette", description: "Ingen D&B/Bisnode-snapshots med dato 2026-08-25 ble funnet i denne databasen.", variant: "destructive" });
          return;
        }
        toast({ title: "Snapshot-dato rettet", description: `${result.updatedCount} D&B/Bisnode-rader er flyttet fra 25.08.2026 til 19.04.2024. Prioriteringen er beregnet på nytt.` });
      },
      onError: () => toast({ title: "Kunne ikke rette snapshot-dato", description: "Kildehistorikken ble ikke endret.", variant: "destructive" }),
    },
  });
  const bulkRelevanceMutation = useBulkUpdateCandidateRelevance({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
        setSelectedCandidateIds([]);
        setConfirmBulkDecision(false);
        toast({ title: "Samlet relevans lagret", description: `${result.updatedCount} selskaper er satt til ${relevanceLabel(result.relevanceStatus).toLocaleLowerCase("nb-NO")}. Valget er markert som manuelt og kan endres per selskap.` });
      },
      onError: () => toast({ title: "Kunne ikke lagre samlet relevans", description: "Ingen av valgene er endret.", variant: "destructive" }),
    },
  });
  const batchMutation = useCreateCandidateAnalysisBatch({
    mutation: {
      onSuccess: (batch) => toast({ title: "Gjennomgangsliste klar", description: `${batch.selectedCount} selskaper er valgt fra ${scopeLabel(workScope)}. Dette er en arbeidsliste, ikke en ny kildeimport.` }),
      onError: () => toast({ title: "Kunne ikke opprette gjennomgangsliste", variant: "destructive" }),
    },
  });
  const crmEnrichmentMutation = useEnrichCandidateCrm({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
      },
    },
  });

  const handleCrmEnrichment = async () => {
    if (!visibleCandidates.length || crmEnrichmentMutation.isPending) return;
    const batchSize = 100;
    const totals = {
      requestedCount: 0,
      enrichedCount: 0,
      noMatchCount: 0,
      ambiguousCount: 0,
      unavailableCount: 0,
    };

    try {
      for (let index = 0; index < visibleCandidates.length; index += batchSize) {
        const result = await crmEnrichmentMutation.mutateAsync({
          data: { candidateIds: visibleCandidates.slice(index, index + batchSize).map((candidate) => candidate.id) },
        });
        totals.requestedCount += result.requestedCount;
        totals.enrichedCount += result.enrichedCount;
        totals.noMatchCount += result.noMatchCount;
        totals.ambiguousCount += result.ambiguousCount;
        totals.unavailableCount += result.unavailableCount;
      }
      toast({
        title: "CRM-grunnlag oppdatert",
        description: `${totals.requestedCount} behandlet: ${totals.enrichedCount} sikre treff, ${totals.noMatchCount} uten treff, ${totals.ambiguousCount} uavklarte og ${totals.unavailableCount} midlertidig utilgjengelige.`,
      });
    } catch {
      toast({
        title: "CRM-oppdateringen stoppet",
        description: `Noen puljer kan være oppdatert. ${totals.requestedCount} av ${visibleCandidates.length} kandidater er behandlet så langt.`,
        variant: "destructive",
      });
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || isImporting) return;
    let processedRecords = 0;
    try {
      setIsImporting(true);
      const records = await parseCandidateFile(file);
      const batchSize = 100;
      const totals = { created: 0, matched: 0, needsReview: 0, skipped: 0 };
      for (let index = 0; index < records.length; index += batchSize) {
        const result = await importMutation.mutateAsync({
          data: { sourceType, snapshotDate, records: records.slice(index, index + batchSize) } satisfies CandidateImportInput,
        });
        totals.created += result.created;
        totals.matched += result.matched;
        totals.needsReview += result.needsReview;
        totals.skipped += result.skipped;
        processedRecords += Math.min(batchSize, records.length - index);
      }
      toast({ title: "Hovedlisten er oppdatert", description: `${totals.created} nye selskaper, ${totals.matched} matchet, ${totals.skipped} hoppet over og ${totals.needsReview} trenger avklaring.` });
    } catch (error) {
      const partialImportNotice = processedRecords ? `De første ${processedRecords} radene kan være importert. ` : "";
      toast({ title: "Importen stoppet", description: `${partialImportNotice}${importErrorMessage(error)}`, variant: "destructive" });
    } finally {
      setIsImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const monitoredCount = candidates?.filter((candidate) => candidate.monitoringStatus === "monitoring").length ?? 0;
  const followUpCount = candidates?.filter((candidate) => candidate.relevanceStatus === "relevant" && candidate.monitoringStatus !== "monitoring").length ?? 0;
  const reviewCount = candidates?.filter(isInvestigationCandidate).length ?? 0;
  const crmReviewCount = candidates?.filter((candidate) => ["not_found", "ambiguous", "unavailable"].includes(candidate.crmEnrichment?.status ?? "")).length ?? 0;
  const selectedCandidates = visibleCandidates.filter((candidate) => selectedCandidateIds.includes(candidate.id));
  const toggleCandidateSelection = (candidateId: number) => {
    setSelectedCandidateIds((current) => current.includes(candidateId) ? current.filter((id) => id !== candidateId) : [...current, candidateId]);
  };
  const selectVisibleReviewCandidates = () => setSelectedCandidateIds(visibleCandidates.map((candidate) => candidate.id));

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
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Hva bør du gjøre nå?</CardTitle>
              <CardDescription>Start med høyest prioritet: følg opp relevante selskaper og avklar usikre.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm divide-y divide-border/70 md:grid-cols-3 md:divide-x md:divide-y-0">
              <FocusAction
                icon={<CircleCheck className="h-4 w-4 text-primary" />}
                title="Følg med på"
                count={followUpCount}
                description="Relevant, men ikke overvåket."
                action={() => { setView("follow_up"); setSelectedCandidateIds([]); }}
              />
              <FocusAction
                icon={<CircleAlert className="h-4 w-4 text-destructive" />}
                title="Undersøk nærmere"
                count={reviewCount}
                description="Mulig eller uavklart."
                action={() => { setView("review"); setSelectedCandidateIds([]); }}
              />
              <FocusAction
                icon={<Radio className="h-4 w-4 text-primary" />}
                title="Følger allerede"
                count={monitoredCount}
                description="Aktiv overvåkning."
                action={() => { setView("monitoring"); setSelectedCandidateIds([]); }}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
                <span className="mr-1 flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arbeidsutvalg</span>
                {([
                  ["universe", "Hovedliste", candidates?.length ?? 0],
                  ["follow_up", "Følg med på", followUpCount],
                  ["monitoring", "Overvåkes", monitoredCount],
                  ["review", "Undersøk nærmere", reviewCount],
                  ["crm_review", "CRM-avklaring", crmReviewCount],
                ] as const).map(([nextView, label, count]) => (
                  <Button key={nextView} size="sm" variant={view === nextView ? "default" : "outline"} onClick={() => { setView(nextView); setSelectedCandidateIds([]); }}>{label} ({count})</Button>
                ))}
              </div>
              <div className="flex flex-col gap-3 px-4 py-3">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                  <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Søk etter selskap, domene eller bransje…" /></div>
                <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm">
                  <ListFilter className="h-4 w-4 text-muted-foreground" />
                  <span className="sr-only">Filtrer på prioritet</span>
                  <select aria-label="Filtrer på prioritet" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)} className="bg-transparent outline-none">
                    <option value="all">Alle prioriteter</option>
                    <option value="high">Høy prioritet (25+)</option>
                    <option value="some">Noe prioritet (1–24)</option>
                    <option value="none">Ingen prioritet (0 eller lavere)</option>
                  </select>
                </label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm">
                  {candidateSort === "company_asc" ? <ArrowDownAZ className="h-4 w-4 text-muted-foreground" /> : <ArrowUpDown className="h-4 w-4 text-muted-foreground" />}
                  <span className="sr-only">Sorter kandidater</span>
                  <select aria-label="Sorter kandidater" value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as CandidateSort)} className="bg-transparent outline-none">
                    <option value="priority_desc">Høyest prioritet først</option>
                    <option value="priority_asc">Lavest prioritet først</option>
                    <option value="company_asc">Selskapsnavn A–Å</option>
                  </select>
                </label>
                  <select aria-label="Velg arbeidsomfang for gjennomgangsliste" value={workScope} onChange={(event) => setWorkScope(event.target.value as WorkScope)} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                    <option value="monitoring">Overvåkningslisten</option><option value="relevant">Alle relevante</option><option value="universe">Hele hovedlisten</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">Viser {visibleCandidates.length} selskaper etter søk, utvalg og prioriteringsfilter.</p>
                  <details className="group relative">
                    <summary className="flex cursor-pointer list-none items-center justify-center rounded-md border border-input px-3 py-2 text-sm font-medium transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
                      Flere verktøy
                    </summary>
                    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-card p-2 shadow-sm sm:absolute sm:right-0 sm:z-10 sm:w-max sm:flex-row">
                      <Button size="sm" variant="outline" onClick={() => batchMutation.mutate({ data: { scope: workScope } })} disabled={batchMutation.isPending}><ListChecks className="mr-2 h-4 w-4" /> {batchMutation.isPending ? "Oppretter…" : "Opprett gjennomgangsliste"}</Button>
                      <Button size="sm" variant="outline" onClick={handleCrmEnrichment} disabled={!visibleCandidates.length || crmEnrichmentMutation.isPending}><DatabaseZap className="mr-2 h-4 w-4" /> {crmEnrichmentMutation.isPending ? `Oppdaterer CRM (${visibleCandidates.length})…` : `Oppdater CRM (${visibleCandidates.length})`}</Button>
                    </div>
                  </details>
                </div>
              </div>
            </CardContent>
          </Card>

           {view === "crm_review" ? <Card className="border-accent/40 bg-accent/10"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><DatabaseZap className="h-4 w-4 text-accent-foreground" /> CRM-avklaringskø</CardTitle><CardDescription>Viser kandidater med manglende, tvetydig eller midlertidig utilgjengelig CRM-match. Ingen treff slås sammen automatisk; åpne kandidaten for å se identifikatorer, historikk og kontaktgrunnlag.</CardDescription></CardHeader></Card> : null}

           {view === "review" ? <Card className="border-accent/40 bg-accent/10">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CheckCheck className="h-4 w-4 text-accent-foreground" /> Samlet vurdering</CardTitle><CardDescription>Bruk dette for en gruppe du vil behandle likt. Sterke systemtreff blir allerede merket relevante; velg «Mulig relevant» når informasjonen er for tynn til en endelig beslutning.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={selectVisibleReviewCandidates} disabled={!visibleCandidates.length}>Velg alle i utvalget ({visibleCandidates.length})</Button>
                {selectedCandidateIds.length ? <Button size="sm" variant="ghost" onClick={() => setSelectedCandidateIds([])}>Tøm valg</Button> : null}
                <span className="text-sm text-muted-foreground">{selectedCandidateIds.length} valgt</span>
              </div>
              <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                <label className="grid gap-1 text-sm font-medium">Sett relevans
                  <select value={bulkRelevanceStatus} onChange={(event) => setBulkRelevanceStatus(event.target.value as ManualRelevanceStatus)} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                    <option value="relevant">Relevant</option><option value="possible">Mulig relevant</option><option value="not_relevant">Ikke relevant</option><option value="needs_review">Må vurderes</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium">Felles begrunnelse (valgfritt)<Input value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} placeholder="For eksempel: Avventer bedre firmadata" /></label>
                <Button onClick={() => setConfirmBulkDecision(true)} disabled={!selectedCandidateIds.length || bulkRelevanceMutation.isPending}>Bruk på {selectedCandidateIds.length} valgte</Button>
              </div>
            </CardContent>
          </Card> : null}

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {isLoading ? <div className="space-y-3 p-6">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-24 w-full" />)}</div> : visibleCandidates.length ? (
              <div className="divide-y divide-border">
                {visibleCandidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} pending={monitoringMutation.isPending} selectable={view === "review"} selected={selectedCandidateIds.includes(candidate.id)} onToggleSelection={() => toggleCandidateSelection(candidate.id)} onToggleMonitoring={() => monitoringMutation.mutate({ id: candidate.id, data: { monitoringStatus: candidate.monitoringStatus === "monitoring" ? "not_monitoring" : "monitoring" } })} />)}
              </div>
            ) : <div className="p-12 text-center text-muted-foreground"><UsersRound className="mx-auto mb-3 h-10 w-10 text-primary" /><p className="font-medium text-foreground">Ingen selskaper i dette utvalget</p><p className="mt-1 text-sm">Selskaper som tas ut av overvåkning er fortsatt tilgjengelige i hovedlisten.</p></div>}
          </div>

           <details className="group rounded-xl border border-border bg-card">
             <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
               <span className="flex items-center gap-2"><FileUp className="h-4 w-4 text-muted-foreground" /> Administrer kilde-snapshots</span>
               <span className="text-xs text-muted-foreground group-open:hidden">Sjelden brukt</span>
               <span className="hidden text-xs text-muted-foreground group-open:inline">Skjul</span>
             </summary>
             <div className="border-t border-border p-4">
               <p className="mb-3 max-w-3xl text-sm text-muted-foreground">Importer CSV eller Excel (.xlsx) når du har et nytt D&amp;B/Bisnode- eller Sales Navigator-utdrag. Nye observasjoner legges til historikken uten å slette selskaper eller overvåkningsvalg.</p>
               <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
                 <label className="grid gap-1 text-sm font-medium">Kilde
                   <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                     <option value="dnb_bisnode">D&amp;B/Bisnode</option><option value="sales_navigator">Sales Navigator</option><option value="manual">Manuelt utdrag</option>
                   </select>
                 </label>
                 <label className="grid gap-1 text-sm font-medium">Snapshot-dato<Input type="date" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} /></label>
                 <input ref={fileRef} className="hidden" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => handleFile(event.target.files?.[0])} />
                 <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={isImporting}><FileUp className="mr-2 h-4 w-4" /> {isImporting ? "Oppdaterer…" : "Velg nytt snapshot"}</Button>
               </div>
               <div className="mt-4 flex flex-col gap-3 rounded-md border border-accent/30 bg-accent/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                 <div><p className="font-medium">Rett dato på første D&amp;B/Bisnode-import</p><p className="text-muted-foreground">Flytter 25.08.2026 til 19.04.2024 uten ny import eller tap av historikk.</p></div>
                 <Button size="sm" variant="outline" onClick={() => setConfirmDateCorrection(true)} disabled={dateCorrectionMutation.isPending}>Rett snapshot-dato</Button>
               </div>
             </div>
           </details>
        </div>
      </div>
      <AlertDialog open={confirmDateCorrection} onOpenChange={setConfirmDateCorrection}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Rette dato for D&amp;B/Bisnode-import?</AlertDialogTitle><AlertDialogDescription>Alle D&amp;B/Bisnode-snapshots med dato 25.08.2026 flyttes til 19.04.2024. Ingen selskaper, kildeverdier eller overvåkningsvalg slettes. Prioriteringer oppdateres etterpå.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Avbryt</AlertDialogCancel><AlertDialogAction onClick={() => dateCorrectionMutation.mutate({ data: { sourceType: "dnb_bisnode", fromSnapshotDate: "2026-08-25", toSnapshotDate: "2024-04-19" } })}>Rett dato</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmBulkDecision} onOpenChange={setConfirmBulkDecision}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Bruke samlet relevans på {selectedCandidates.length} selskaper?</AlertDialogTitle><AlertDialogDescription>Dette setter {relevanceLabel(bulkRelevanceStatus).toLocaleLowerCase("nb-NO")} som en manuell vurdering for utvalget. Selskapene og kildehistorikken beholdes, og beslutningen kan endres senere.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Avbryt</AlertDialogCancel><AlertDialogAction onClick={() => bulkRelevanceMutation.mutate({ data: { candidateIds: selectedCandidates.map((candidate) => candidate.id), relevanceStatus: bulkRelevanceStatus, reason: bulkReason.trim() || "Samlet vurdering fra hovedlisten." } })}>Bekreft samlet vurdering</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function scopeLabel(scope: WorkScope) {
  return { universe: "hele hovedlisten", relevant: "alle relevante selskaper", monitoring: "overvåkningslisten" }[scope];
}

function FocusAction({ icon, title, count, description, action }: { icon: React.ReactNode; title: string; count: number; description: string; action: () => void }) {
  return (
    <button type="button" onClick={action} className="group flex min-w-0 items-start justify-between gap-3 p-3 text-left transition-colors hover:bg-primary/5 md:px-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-semibold">{icon}{title}</p>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xl font-bold">{count}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function CandidateRow({ candidate, pending, selectable, selected, onToggleSelection, onToggleMonitoring }: { candidate: Candidate; pending: boolean; selectable: boolean; selected: boolean; onToggleSelection: () => void; onToggleMonitoring: () => void }) {
  return <div className="flex items-center gap-4 p-4 sm:px-6">
    {selectable ? <Checkbox checked={selected} onCheckedChange={onToggleSelection} aria-label={`Velg ${candidate.companyName}`} /> : null}
    <Link href={`/candidates/${candidate.id}`} className="group min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold group-hover:text-primary">{candidate.companyName}</span><PriorityBadge score={candidate.priorityScore} /><RelevanceBadge status={candidate.relevanceStatus} /><MonitoringBadge status={candidate.monitoringStatus} /></div>
      <p className="mt-1 text-sm text-muted-foreground">{candidate.relevanceReason ?? candidate.priorityReasons[0]}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{candidate.snapshots.length} snapshots</span>{candidate.employees ? <span>{candidate.employees.toLocaleString("nb-NO")} ansatte</span> : null}<span>{candidate.evidence.length} offentlige kilder</span>{candidate.crmEnrichment ? <span>{crmStatusLabel(candidate.crmEnrichment.status)}</span> : <span>CRM ikke oppdatert</span>}</div>
    </Link>
    <Button size="sm" variant={candidate.monitoringStatus === "monitoring" ? "outline" : "default"} onClick={onToggleMonitoring} disabled={pending}>{candidate.monitoringStatus === "monitoring" ? "Trekk fra" : "Overvåk"}</Button>
    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
  </div>;
}

function crmStatusLabel(status: NonNullable<Candidate["crmEnrichment"]>["status"]) {
  return { matched: "CRM sikkert treff", not_found: "CRM uten treff", ambiguous: "CRM uavklart", unavailable: "CRM utilgjengelig" }[status];
}

function isInvestigationCandidate(candidate: Candidate) {
  return candidate.relevanceStatus === "possible"
    || candidate.relevanceStatus === "needs_review"
    || candidate.relevanceStatus === "insufficient_data"
    || candidate.matchStatus === "needs_review";
}