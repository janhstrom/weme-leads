import { useMemo, useState } from "react";
import { useListSignals, type ListSignalsParams } from "@workspace/api-client-react";
import { Card } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Input } from "@workspace/weme-earth-tones-system/components/ui/input";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { CheckCircle, Search } from "lucide-react";
import { SignalRow } from "./dashboard";

export default function AllSignalsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ListSignalsParams["status"] | "all">("all");
  const params = useMemo(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status === "all" ? {} : { status }),
  }), [search, status]);
  const { data: signals, isLoading } = useListSignals(params);

  return <div className="h-full flex flex-col">
    <header className="h-14 min-h-[56px] border-b border-border bg-card flex items-center px-6 shrink-0">
      <div><h1 className="font-semibold text-lg">Alle signaler</h1><p className="text-xs text-muted-foreground">Historikk og aktive signaler. «Følg opp nå» er en separat, prioritert kø.</p></div>
    </header>
    <div className="flex-1 overflow-auto p-6 bg-background">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">{(["all", "til_vurdering", "godkjent", "avvist", "følg_videre"] as const).map((option) => <button key={option} type="button" onClick={() => setStatus(option)} className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${status === option ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>{option === "all" ? "Alle" : option.replace("_", " ")}</button>)}</div>
          <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Søk i signaler…" className="pl-9" /></div>
        </div>
        <Card className="overflow-hidden">
          {isLoading ? <div className="space-y-3 p-6">{[1, 2, 3].map((row) => <Skeleton key={row} className="h-20 w-full" />)}</div> : signals?.length ? <div className="divide-y divide-border">{signals.map((signal) => <SignalRow key={signal.id} signal={signal} />)}</div> : <div className="p-12 text-center text-muted-foreground"><CheckCircle className="mx-auto mb-4 h-10 w-10 text-primary" /><p className="font-medium text-foreground">Ingen signaler i dette utvalget</p><p className="mt-1 text-sm">Nye signaler opprettes først når en overvåket kandidat har en registrert, offisiell kilde.</p></div>}
        </Card>
      </div>
    </div>
  </div>;
}