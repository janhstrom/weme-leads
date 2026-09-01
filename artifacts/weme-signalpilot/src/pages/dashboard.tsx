import {
  getGetLatestMonitoringRunQueryKey,
  getListMonitoringActionsQueryKey,
  useGetLatestMonitoringRun,
  useListMonitoringActions,
  useStartMonitoringRun,
  Signal,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { Input } from "@workspace/weme-earth-tones-system/components/ui/input";
import { Building2, Calendar, Zap, ArrowRight, CheckCircle2, Clock, CheckCircle, FileSearch, Info, PlayCircle, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow, parseISO } from "date-fns";
import { nb } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: latestRun, isLoading: isLoadingRun } = useGetLatestMonitoringRun();
  const { data: signals, isLoading: isLoadingSignals } = useListMonitoringActions();
  const runMutation = useStartMonitoringRun({
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetLatestMonitoringRunQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListMonitoringActionsQueryKey() }),
        ]);
      },
    },
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="h-14 min-h-[56px] border-b border-border bg-card flex items-center px-6 shrink-0">
        <h1 className="font-semibold text-lg">WeMe Leads</h1>
      </header>

      <div className="flex-1 overflow-auto p-6 bg-background">
        <div className="max-w-6xl mx-auto space-y-6">
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard 
              title="Følg opp nå" 
              value={signals?.length} 
              loading={isLoadingSignals} 
              icon={<Clock className="w-4 h-4 text-accent" />} 
            />
            <SummaryCard 
              title="Nye signaler" 
              value={latestRun?.signalsCreated} 
              loading={isLoadingRun} 
              icon={<CheckCircle2 className="w-4 h-4 text-chart-2" />} 
            />
            <SummaryCard 
              title="CRM-avklaring" 
              value={latestRun?.crmUnresolvedCount} 
              loading={isLoadingRun} 
              icon={<Zap className="w-4 h-4 text-destructive" />} 
            />
            <SummaryCard 
              title="Kildeavvik" 
              value={latestRun?.sourceErrorCount} 
              loading={isLoadingRun} 
              icon={<Building2 className="w-4 h-4 text-primary" />} 
            />
          </div>

          <Card className="border-primary/20 bg-primary/5 shadow-none">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Info className="h-4 w-4 text-primary" />
                  Løpende signalkø
                </CardTitle>
                <button
                  type="button"
                  onClick={() => runMutation.mutate({})}
                  disabled={runMutation.isPending || latestRun?.status === "running"}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FileSearch className={`h-4 w-4 ${runMutation.isPending || latestRun?.status === "running" ? "animate-pulse" : ""}`} />
                  {runMutation.isPending || latestRun?.status === "running" ? "Kjører overvåkning…" : "Kjør overvåkning nå"}
                </button>
              </div>
              {runMutation.isError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  Kjøringen kunne ikke startes. {runMutation.error instanceof Error ? runMutation.error.message : "Prøv igjen senere."}
                </p>
              )}
              {latestRun ? <p className={`rounded-md px-3 py-2 text-sm ${latestRun.status === "completed_with_errors" || latestRun.status === "failed" ? "border border-destructive/30 bg-destructive/10 text-destructive" : "border border-border bg-muted/40 text-foreground"}`}>
                Siste kjøring: {latestRun.status === "running" ? "pågår" : latestRun.status === "completed" ? "fullført" : latestRun.status === "completed_with_errors" ? "fullført med avvik" : "feilet"} · {latestRun.processedCount}/{latestRun.requestedCount} kandidater · {latestRun.signalsCreated} nye signaler · {latestRun.sourceErrorCount} kildeavvik{latestRun.errorSummary ? ` · ${latestRun.errorSummary}` : ""}
              </p> : <p className="text-sm text-muted-foreground">Ingen kjøring er registrert ennå. Kjør overvåkning når du har lagt inn offisielle feeds på kandidatene.</p>}
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <PlayCircle className="h-4 w-4 text-primary" />
                  Hva køen viser nå
                </div>
                <p className="text-muted-foreground">
                  Bare nye, URL-verifiserte funn fra aktive overvåkningskilder vises her. Klikk på et signal for kilde, CRM-kontekst og anbefalt kontaktrolle.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <FileSearch className="h-4 w-4 text-primary" />
                  Slik bestemmes omfanget
                </div>
                <p className="text-muted-foreground">
                  Kjøringen omfatter kun kandidater som overvåkes. Brønnøysund sjekker organisasjonsnummeret, og CRM oppdateres kun med lesing.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <Building2 className="h-4 w-4 text-primary" />
                  Avklar først når det trengs
                </div>
                <p className="text-muted-foreground">
                  <Link href="/candidates?view=crm-review" className="font-medium text-primary hover:underline">Se CRM-avklaringskøen</Link> for manglende, tvetydige eller midlertidig utilgjengelige treff. Ingen selskap fjernes automatisk.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
            {isLoadingSignals ? (
              <div className="p-6 space-y-4">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : signals?.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                <CheckCircle className="w-12 h-12 mb-4 text-muted" />
                  <p className="text-lg font-medium text-foreground">Ingen aktive oppfølginger ennå</p>
                  <p className="mt-1 max-w-md text-sm">Legg en kandidat i overvåkning og registrer et offisielt RSS- eller Atom-feed på kandidaten før neste kjøring.</p>
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

export function SignalRow({ signal }: { signal: Signal }) {
  return (
    <Link href={`/signals/${signal.id}`} className="block p-4 sm:px-6 hover:bg-muted/30 transition-colors group">
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
          <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function StrengthBadge({ strength }: { strength: string }) {
  const colors = {
    A: "border-destructive/50 bg-destructive/10 text-destructive",
    B: "border-accent/60 bg-accent/20 text-foreground",
    C: "border-primary/50 bg-primary/15 text-foreground",
  } as Record<string, string>;
  
  return (
    <Badge variant="outline" className={`${colors[strength] || 'border-border bg-muted/40 text-muted-foreground'} px-1.5 py-0 text-[10px] font-bold`}>
      {strength}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles = {
    til_vurdering: "border-accent/60 bg-accent/20 text-foreground",
    godkjent: "border-primary/50 bg-primary/15 text-foreground",
    avvist: "border-destructive/50 bg-destructive/10 text-destructive",
    allerede_kjent: "border-border bg-muted/40 text-muted-foreground",
    følg_videre: "border-primary/50 bg-primary/15 text-foreground",
  } as Record<string, string>;

  return (
    <Badge variant="outline" className={`${styles[status] || 'border-border bg-muted/40 text-muted-foreground'} text-[10px] font-semibold`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}
