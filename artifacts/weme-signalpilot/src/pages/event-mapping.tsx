import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  EventMappingItem,
  getGetLatestEventMappingRunQueryKey,
  getListEventMappingItemsQueryKey,
  useGetLatestEventMappingRun,
  useListEventMappingItems,
  useStartEventMappingRun,
} from "@workspace/api-client-react";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";
import { Button } from "@workspace/weme-earth-tones-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, CircleDashed, FileSearch, Link2Off, PlayCircle, Radio, XCircle } from "lucide-react";

type OutcomeFilter = "all" | EventMappingItem["outcome"];

const outcomeMeta: Record<EventMappingItem["outcome"], { label: string; icon: typeof CheckCircle2; className: string }> = {
  event_found: { label: "Hendelse funnet", icon: CheckCircle2, className: "bg-primary text-primary-foreground" },
  no_event: { label: "Ingen fersk hendelse", icon: CircleDashed, className: "bg-secondary text-secondary-foreground" },
  no_source: { label: "Mangler kilde", icon: Link2Off, className: "bg-accent text-accent-foreground" },
  source_error: { label: "Kildefeil", icon: AlertTriangle, className: "bg-destructive text-destructive-foreground" },
};

export default function EventMappingPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const latest = useGetLatestEventMappingRun({ query: { queryKey: getGetLatestEventMappingRunQueryKey(), retry: false } });
  const run = latest.data;
  const items = useListEventMappingItems(run?.id ?? 0, {
    query: {
      enabled: Boolean(run?.id),
      queryKey: getListEventMappingItemsQueryKey(run?.id ?? 0),
      retry: false,
    },
  });
  const start = useStartEventMappingRun({
    mutation: {
      onSuccess: async (startedRun) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetLatestEventMappingRunQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListEventMappingItemsQueryKey(startedRun.id) }),
        ]);
      },
    },
  });

  useEffect(() => {
    if (run?.status !== "running") return;
    const interval = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: getGetLatestEventMappingRunQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getListEventMappingItemsQueryKey(run.id) });
    }, 2_500);
    return () => window.clearInterval(interval);
  }, [queryClient, run?.id, run?.status]);

  const visibleItems = useMemo(
    () => (items.data ?? []).filter((item) => filter === "all" || item.outcome === filter),
    [filter, items.data],
  );
  const counts = useMemo(() => (items.data ?? []).reduce<Record<OutcomeFilter, number>>(
    (summary, item) => ({ ...summary, [item.outcome]: summary[item.outcome] + 1 }),
    { all: items.data?.length ?? 0, event_found: 0, no_event: 0, no_source: 0, source_error: 0 },
  ), [items.data]);

  return (
    <div className="flex h-full flex-col">
      <header className="min-h-[56px] border-b border-border bg-card px-6 py-3">
        <h1 className="text-lg font-semibold">Kartlegg nylige hendelser</h1>
        <p className="text-xs text-muted-foreground">Engangskartlegging for alle kandidater som er Mulig relevant.</p>
      </header>
      <div className="flex-1 overflow-auto bg-background p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <Card className="border-primary/20 bg-primary/5 shadow-none">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><FileSearch className="h-4 w-4 text-primary" /> Offentlig hendelseskartlegging</CardTitle>
                  <CardDescription className="mt-2 max-w-3xl">Vi ser etter ferske, URL-verifiserte signaler i registrerte feeder, standardiserte feed-adresser, offisielle presserom-, nyhets- og karrieresider på kandidatens eget domene, samt relevante registerobservasjoner. Dette starter ikke løpende overvåkning og bruker ikke CRM.</CardDescription>
                </div>
                <Button onClick={() => start.mutate()} disabled={start.isPending || run?.status === "running"}>
                  <PlayCircle className={`mr-2 h-4 w-4 ${start.isPending || run?.status === "running" ? "animate-pulse" : ""}`} />
                  {start.isPending || run?.status === "running" ? "Kartlegger…" : "Kartlegg nå"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {start.isError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">Kartleggingen kunne ikke startes. {start.error instanceof Error ? start.error.message : "Prøv igjen senere."}</p> : null}
              {run ? <div className={`rounded-md p-3 ${run.status === "failed" || run.status === "completed_with_errors" ? "border border-destructive/30 bg-destructive/10 text-destructive" : "bg-secondary/60 text-muted-foreground"}`}>
                {run.status === "running" ? "Kartlegging pågår" : run.status === "completed" ? "Siste kartlegging er fullført" : run.status === "completed_with_errors" ? "Siste kartlegging er fullført med avvik" : "Siste kartlegging feilet"} · {run.processedCount}/{run.requestedCount} kandidater · {run.signalsCreated} nye hendelser · {run.sourceErrorCount} kildeavvik{run.errorSummary ? ` · ${run.errorSummary}` : ""}
              </div> : <p className="text-muted-foreground">Ingen kartlegging er kjørt ennå.</p>}
              <div className="grid gap-3 text-muted-foreground sm:grid-cols-3">
                <p><strong className="text-foreground">Avgrenset kildebruk.</strong> Kun kandidatens eget domene, registrerte feeds og Brønnøysundregistrene. Ingen bred web-crawling, betalingsmurer eller LinkedIn-scraping.</p>
                <p><strong className="text-foreground">Ingen automatisk vurdering.</strong> En hendelse er kildegrunnlag, ikke en automatisk oppgradering til Relevant.</p>
                <p><strong className="text-foreground">Ingen overvåkning.</strong> Kandidater må velges eksplisitt dersom de senere skal følges løpende.</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(outcomeMeta) as EventMappingItem["outcome"][]).map((outcome) => {
              const meta = outcomeMeta[outcome];
              const Icon = meta.icon;
              return <button key={outcome} type="button" onClick={() => setFilter(filter === outcome ? "all" : outcome)} className={`rounded-xl border p-4 text-left transition-colors ${filter === outcome ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:border-primary/50"}`}>
                <div className="flex items-center justify-between"><span className="text-sm font-medium text-muted-foreground">{meta.label}</span><Icon className="h-4 w-4 text-primary" /></div>
                <p className="mt-2 text-2xl font-bold">{counts[outcome]}</p>
              </button>;
            })}
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div><CardTitle className="text-base">Kandidatutvalg</CardTitle><CardDescription>{filter === "all" ? `${counts.all} registrerte utfall` : outcomeMeta[filter].label}</CardDescription></div>
              {filter !== "all" ? <Button variant="ghost" size="sm" onClick={() => setFilter("all")}><XCircle className="mr-2 h-4 w-4" />Vis alle</Button> : null}
            </CardHeader>
            <CardContent className="p-0">
              {items.isLoading ? <div className="space-y-3 p-6">{[1, 2, 3].map((row) => <Skeleton key={row} className="h-20 w-full" />)}</div> : !run ? <EmptyState title="Start kartleggingen når du er klar" description="Utvalget består av kandidater som nå er vurdert som Mulig relevant." /> : !visibleItems.length ? <EmptyState title="Ingen kandidater i dette utfallet" description="Velg et annet filter eller vent mens kartleggingen behandler flere kandidater." /> : <div className="divide-y divide-border">{visibleItems.map((item) => <MappingRow key={item.candidateId} item={item} />)}</div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MappingRow({ item }: { item: EventMappingItem }) {
  const meta = outcomeMeta[item.outcome];
  const Icon = meta.icon;
  return <Link href={`/candidates/${item.candidateId}`} className="flex items-start gap-3 p-4 transition-colors hover:bg-secondary/30 sm:px-6">
    <div className="mt-0.5 rounded-full bg-secondary p-2 text-primary"><Icon className="h-4 w-4" /></div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.candidateName}</p><Badge className={meta.className}>{meta.label}</Badge>{item.signalsCreated > 0 ? <Badge variant="outline">{item.signalsCreated} ny(e) funn</Badge> : null}</div>
      <p className="mt-1 text-sm text-muted-foreground">{item.message ?? "Ingen ytterligere forklaring er registrert."}</p>
      {item.checkedSources.length ? <div className="mt-3 flex flex-wrap gap-2">{item.checkedSources.map((source) => <a key={`${source.family}-${source.url}`} href={source.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-secondary ${source.status === "error" ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground"}`} title={source.detail ?? source.url}><span className="font-medium text-foreground">{sourceFamilyLabel(source.family)}</span><span className="max-w-48 truncate">{source.label}</span></a>)}</div> : null}
    </div>
  </Link>;
}

function sourceFamilyLabel(family: EventMappingItem["checkedSources"][number]["family"]) {
  return {
    registered_feed: "Registrert feed",
    standard_feed: "RSS/Atom",
    newsroom: "Nyheter",
    careers: "Karriere",
    brreg: "Brønnøysund",
  }[family];
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="p-12 text-center text-muted-foreground"><Radio className="mx-auto mb-3 h-10 w-10 text-primary" /><p className="font-medium text-foreground">{title}</p><p className="mx-auto mt-1 max-w-lg text-sm">{description}</p></div>;
}