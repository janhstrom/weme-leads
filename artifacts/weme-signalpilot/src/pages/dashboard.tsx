import { useGetDashboardSummary, useListSignals, ListSignalsParams, Signal, SignalStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { Input } from "@workspace/weme-earth-tones-system/components/ui/input";
import { Search, Building2, Calendar, Zap, ArrowRight, CheckCircle2, Clock, CheckCircle, FileSearch, Info, PlayCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { formatDistanceToNow, parseISO } from "date-fns";
import { nb } from "date-fns/locale";

export default function DashboardPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListSignalsParams['status'] | 'all'>("til_vurdering");

  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  
  const queryParams = useMemo(() => {
    const params: ListSignalsParams = {};
    if (search) params.search = search;
    if (statusFilter !== 'all') params.status = statusFilter;
    return params;
  }, [search, statusFilter]);

  const { data: signals, isLoading: isLoadingSignals } = useListSignals(queryParams);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="h-14 min-h-[56px] border-b border-border bg-card flex items-center px-6 shrink-0">
        <h1 className="font-semibold text-lg">WeMe Leads</h1>
      </header>

      <div className="flex-1 overflow-auto p-6 bg-background">
        <div className="max-w-6xl mx-auto space-y-6">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard 
              title="Til vurdering" 
              value={summary?.pending} 
              loading={isLoadingSummary} 
              icon={<Clock className="w-4 h-4 text-accent" />} 
              onClick={() => setStatusFilter("til_vurdering")}
              active={statusFilter === "til_vurdering"}
            />
            <SummaryCard 
              title="Godkjent" 
              value={summary?.approved} 
              loading={isLoadingSummary} 
              icon={<CheckCircle2 className="w-4 h-4 text-chart-2" />} 
              onClick={() => setStatusFilter("godkjent")}
              active={statusFilter === "godkjent"}
            />
            <SummaryCard 
              title="Høy prioritet (A)" 
              value={summary?.highPriority} 
              loading={isLoadingSummary} 
              icon={<Zap className="w-4 h-4 text-destructive" />} 
            />
            <SummaryCard 
              title="Oppgaver opprettet" 
              value={summary?.crmTasks} 
              loading={isLoadingSummary} 
              icon={<Building2 className="w-4 h-4 text-primary" />} 
            />
          </div>

          <Card className="border-primary/20 bg-primary/5 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-4 w-4 text-primary" />
                Slik kjører WeMe Leads i v1
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <PlayCircle className="h-4 w-4 text-primary" />
                  Hva som allerede er gjort
                </div>
                <p className="text-muted-foreground">
                  Pilotkjøringen på kildene du ga er allerede gjort. Ingen import kreves for disse tre kandidatene. Nye vurderinger kjøres manuelt, én kandidat om gangen, med én eller flere kilder per kandidat.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <FileSearch className="h-4 w-4 text-primary" />
                  Hvorfor tre kandidater
                </div>
                <p className="text-muted-foreground">
                  Motek, Lyse og Hydro hadde konkrete, kontrollerte primærkilder. Mills og DIPS er ikke tatt med ennå fordi vi ikke fant tilsvarende tilstrekkelig primærkilde.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <Building2 className="h-4 w-4 text-primary" />
                  Universum, signal og CRM-oppslag
                </div>
                <p className="text-muted-foreground">
                  {summary?.total ?? 0} kandidater vises i pilotinnboksen nå. Kontoer er universet, mens en konkret offentlig kilde er signalet. CRM brukes som åpent oppslag for historikk og kontaktvalg — gammel CRM-data begrenser ikke analysen.
                </p>
              </div>
            </CardContent>
          </Card>

          {summary?.rejectedPilotSources && summary.rejectedPilotSources.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Forkastede pilotkilder
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Kontrollert ved siste oppfriskning {formatDistanceToNow(parseISO(summary.pilotSourcesLastRefreshedAt), { addSuffix: true, locale: nb })}. Disse kildene ble hoppet over og er ikke med i innboksen.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.rejectedPilotSources.map((source, index) => (
                  <div key={`${source.url}-${index}`} className="rounded-lg border border-destructive/20 bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{source.company}</span>
                      <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline">
                        <span className="truncate">{source.url}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                    <p className="mt-1 text-muted-foreground">Årsak: {source.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex gap-2">
              {(['all', 'til_vurdering', 'godkjent', 'avvist', 'følg_videre'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status as any)}
                  className={`text-sm px-3 py-1.5 rounded-full font-medium transition-colors ${
                    statusFilter === status 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                >
                  {status === 'all' ? 'Alle' : status.replace('_', ' ')}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Søk etter selskaper..." 
                className="pl-9 bg-card"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* List */}
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
            {isLoadingSignals ? (
              <div className="p-6 space-y-4">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : signals?.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                <CheckCircle className="w-12 h-12 mb-4 text-muted" />
                <p className="text-lg font-medium text-foreground">Ingen signaler funnet</p>
                <p className="text-sm">Ingen signaler matcher filtrene dine akkurat nå.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {signals?.map(signal => (
                  <SignalRow key={signal.id} signal={signal} />
                ))}
              </div>
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, loading, icon, onClick, active }: { title: string, value?: number, loading: boolean, icon: React.ReactNode, onClick?: () => void, active?: boolean }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp 
      className={`p-4 rounded-xl border text-left transition-all ${onClick ? 'cursor-pointer hover:border-primary/50 hover:shadow-sm' : ''} ${active ? 'border-primary ring-1 ring-primary shadow-sm bg-primary/5' : 'bg-card border-border shadow-sm'}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight">
        {loading ? <Skeleton className="h-8 w-12" /> : value ?? 0}
      </div>
    </Comp>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  return (
    <Link href={`/signals/${signal.id}`} className="block p-4 sm:px-6 hover:bg-secondary/30 transition-colors group">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-lg truncate group-hover:text-primary transition-colors">{signal.company.name}</span>
            <StrengthBadge strength={signal.strength} />
            <StatusBadge status={signal.status} />
          </div>
          <div className="text-sm font-medium mb-1.5 flex items-center gap-2 text-foreground/80">
            <Zap className="w-3.5 h-3.5 text-accent" />
            {signal.signalType}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {signal.summary}
          </p>
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground font-mono">
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              {signal.company.industry} • {signal.company.employees} ansatte
            </div>
            {signal.publishedAt && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {formatDistanceToNow(parseISO(signal.publishedAt), { addSuffix: true, locale: nb })}
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center justify-center pt-2">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function StrengthBadge({ strength }: { strength: string }) {
  const colors = {
    A: "bg-destructive text-destructive-foreground",
    B: "bg-accent text-accent-foreground",
    C: "bg-primary text-primary-foreground",
  } as Record<string, string>;
  
  return (
    <Badge variant="outline" className={`${colors[strength] || 'bg-secondary text-secondary-foreground'} border-transparent px-1.5 py-0 text-[10px] font-bold`}>
      {strength}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles = {
    til_vurdering: "bg-secondary text-secondary-foreground border-transparent",
    godkjent: "bg-primary text-primary-foreground border-primary",
    avvist: "bg-destructive text-destructive-foreground border-destructive",
    allerede_kjent: "bg-muted text-muted-foreground border-muted",
    følg_videre: "bg-accent text-accent-foreground border-accent",
  } as Record<string, string>;

  return (
    <Badge variant="outline" className={`${styles[status] || ''} text-[10px] font-semibold uppercase tracking-wider`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}
