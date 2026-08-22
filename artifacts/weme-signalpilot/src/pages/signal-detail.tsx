import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { 
  useGetSignal, 
  useReviewSignal, 
  useCreateCrmTask, 
  useSearchCrmContacts,
  useVerifySignalCrmContact,
  useAddSignalEvidence,
  SignalReviewInputStatus, 
  getGetDashboardSummaryQueryKey,
  getListSignalsQueryKey,
  getGetSignalQueryKey,
  getSearchCrmContactsQueryKey,
  Signal
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO, addDays, format } from "date-fns";
import { nb } from "date-fns/locale";

import { Button } from "@workspace/weme-earth-tones-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@workspace/weme-earth-tones-system/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/weme-earth-tones-system/components/ui/tabs";
import { Skeleton } from "@workspace/weme-earth-tones-system/components/ui/skeleton";
import { Textarea } from "@workspace/weme-earth-tones-system/components/ui/textarea";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";
import { useToast } from "@workspace/weme-earth-tones-system/hooks/use-toast";

import { 
  ArrowLeft, Building2, Calendar, Link as LinkIcon, 
  CheckCircle2, XCircle, Clock, CheckSquare,
  MessageSquare, User, Briefcase, Zap, Globe, FileText, Send, Plus
} from "lucide-react";
import { StrengthBadge, StatusBadge } from "./dashboard";

export default function SignalDetailPage() {
  const [, params] = useRoute("/signals/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;
  
  const { data: signal, isLoading, error } = useGetSignal(id, { query: { enabled: !!id, queryKey: getGetSignalQueryKey(id) } });

  if (isLoading) return <DetailSkeleton />;
  if (error || !signal) return <DetailError />;

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Header */}
      <header className="h-14 min-h-[56px] border-b border-border bg-card flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            aria-label="Tilbake til innboksen"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1 rounded-md hover:bg-secondary"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="font-semibold text-lg">{signal.company.name}</h1>
            <StrengthBadge strength={signal.strength} />
            <StatusBadge status={signal.status} />
          </div>
        </div>
      </header>

      {/* Main split view */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        
        {/* Left Column: Context & Evidence */}
        <div className="flex-1 overflow-auto p-6 lg:border-r border-border">
          <div className="max-w-3xl mx-auto space-y-8 pb-12">
            
            {/* Meta */}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground font-mono bg-secondary/30 p-4 rounded-xl">
              <div className="flex items-center gap-1.5">
                <Building2 className="w-4 h-4" />
                {signal.company.industry}
              </div>
              <div className="flex items-center gap-1.5">
                <User className="w-4 h-4" />
                {signal.company.employees} ansatte
              </div>
              <div className="flex items-center gap-1.5">
                <Globe className="w-4 h-4" />
                {signal.company.domain}
              </div>
              {signal.publishedAt && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {formatDistanceToNow(parseISO(signal.publishedAt), { addSuffix: true, locale: nb })}
                </div>
              )}
            </div>

            {/* Signal Description */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-accent" />
                <h2 className="text-xl font-bold">Signalet: {signal.signalType}</h2>
              </div>
              <div className="prose prose-sm md:prose-base prose-slate dark:prose-invert max-w-none">
                <p className="text-lg leading-relaxed text-foreground/90">{signal.summary}</p>
                {signal.rationale && (
                  <div className="mt-4 p-4 bg-secondary/50 rounded-lg border border-border/50">
                    <strong className="text-sm uppercase tracking-wider text-muted-foreground mb-1 block">Hvorfor dette er relevant</strong>
                    <p className="text-sm m-0">{signal.rationale}</p>
                  </div>
                )}
              </div>
            </section>

            {/* Suggested Outreach */}
            {(signal.suggestedOpening || signal.dialogueDraft) && (
              <section className="mt-8">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  Kontaktbrief
                </h3>
                <Card className="bg-primary/5 border-primary/20 shadow-none">
                  <CardContent className="p-5 space-y-4">
                    {signal.suggestedOpening && (
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Åpningsspørsmål</h4>
                        <p className="text-sm font-medium">{signal.suggestedOpening}</p>
                      </div>
                    )}
                    {signal.dialogueDraft && (
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Forslag til inngang</h4>
                        <div className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                          {signal.dialogueDraft}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Evidence Sources */}
            <section>
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-muted-foreground" />
                Kilder og bevis
              </h3>
              <p className="mb-3 text-sm text-muted-foreground">
                «URL kontrollert» betyr at den konkrete HTTPS-kilden svarer og at tittel, dato og sitat er registrert. Relevansen vurderes av selger i review-steget.
              </p>
              <div className="space-y-3">
                {signal.evidence.map((ev, i) => (
                  <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer" className="block p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-sm group-hover:text-primary transition-colors">{ev.title}</h4>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] uppercase font-mono">{ev.sourceType}</Badge>
                        <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/10">
                          <LinkIcon className="w-3 h-3 mr-1" /> URL kontrollert
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 italic border-l-2 border-primary/30 pl-3 my-3">"{ev.excerpt}"</p>
                    <div className="flex items-center text-xs text-muted-foreground font-mono">
                      <LinkIcon className="w-3 h-3 mr-1" /> {new URL(ev.url).hostname}
                      <span className="mx-2">•</span>
                       {format(parseISO(ev.publishedAt), 'd. MMMM yyyy', { locale: nb })}
                    </div>
                  </a>
                ))}
              </div>
              <EvidenceForm signal={signal} />
            </section>
            
          </div>
        </div>

        {/* Right Column: Actions & Contacts */}
        <div className="w-full lg:w-[400px] bg-secondary/10 flex flex-col shrink-0 border-t lg:border-t-0 border-border overflow-hidden">
          <div className="flex-1 overflow-auto p-6 space-y-6">
            
            {/* Review Action Panel */}
            <ActionPanel signal={signal} />

            {/* Contacts */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Anbefalte kontakter</h3>
              {signal.contacts.length > 0 ? (
                <div className="space-y-3">
                  {signal.contacts.map((contact) => (
                    <Card key={contact.id} className="shadow-sm">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-semibold text-sm">{contact.name}</div>
                            <div className="text-xs text-muted-foreground mb-2">{contact.title}</div>
                          </div>
                          <Badge variant="outline" className="text-[10px] capitalize bg-background">
                            {contact.confidence.replace('_', ' ')}
                          </Badge>
                        </div>
                        {contact.rationale && (
                          <div className="text-xs bg-secondary/50 p-2 rounded mt-2 text-muted-foreground">
                            {contact.rationale}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">Ingen konkrete kontakter er identifisert ennå.</div>
              )}
            </div>
            
            {/* CRM Status */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">CRM-oppslag</h3>
              <Card className="bg-card">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${signal.crm.matchCount > 0 ? 'bg-chart-2' : 'bg-destructive'}`} />
                    <span className="text-sm font-medium">{signal.crm.status}</span>
                  </div>
                  <span className="text-xs font-mono bg-secondary px-2 py-1 rounded">
                     {signal.crm.matchCount} treff
                  </span>
                </CardContent>
              </Card>
            </div>
            
          </div>
        </div>
        
      </div>
    </div>
  );
}

function EvidenceForm({ signal }: { signal: Signal }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", sourceType: "Selskapsnyhet", publishedAt: "", excerpt: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useAddSignalEvidence({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetSignalQueryKey(signal.id), updated);
        queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey() });
        setForm({ title: "", url: "", sourceType: "Selskapsnyhet", publishedAt: "", excerpt: "" });
        setOpen(false);
        toast({ title: "Kilde kontrollert", description: "HTTPS-lenken svarer og er lagret med tittel, dato og sitat. Relevansen må fortsatt vurderes." });
      },
      onError: (error) => toast({ title: "Kilden ble ikke godkjent", description: error instanceof Error ? error.message : "Kontroller URL og feltene.", variant: "destructive" }),
    },
  });
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <div className="mt-4">
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" /> Legg inn kildekontrollert kilde</Button>
      ) : (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Ny offentlig primærkilde</CardTitle><CardDescription>Systemet sjekker at en direkte HTTPS-lenke svarer. Du må selv legge inn riktig tittel, dato og sitat; relevansen vurderes ikke automatisk.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {([
              ["title", "Kvalitetssikret tittel"],
              ["url", "Direkte URL (https://...)"],
              ["sourceType", "Kildetype"],
              ["publishedAt", "Publiseringsdato"],
            ] as const).map(([field, label]) => (
              <input key={field} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type={field === "publishedAt" ? "date" : "text"} placeholder={label} value={form[field]} onChange={(event) => update(field, event.target.value)} />
            ))}
            <textarea className="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Sitat fra kilden (minst 20 tegn)" value={form.excerpt} onChange={(event) => update("excerpt", event.target.value)} />
            <div className="flex gap-2">
              <Button onClick={() => mutation.mutate({ id: signal.id, data: form })} disabled={mutation.isPending || Object.values(form).some((value) => !value.trim())}>{mutation.isPending ? "Verifiserer..." : "Verifiser og lagre"}</Button>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={mutation.isPending}>Avbryt</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ActionPanel({ signal }: { signal: Signal }) {
  const [comment, setComment] = useState("");
  const [contactId, setContactId] = useState<number | null>(signal.contacts[0]?.id ?? null);
  const [crmQuery, setCrmQuery] = useState(signal.contacts[0]?.name ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchParams = {
    query: crmQuery.trim(),
    companyDomain: signal.company.domain,
  };
  const crmSearch = useSearchCrmContacts(searchParams, {
    query: { enabled: crmQuery.trim().length >= 2, queryKey: getSearchCrmContactsQueryKey(searchParams) },
  });
  const verifyContactMutation = useVerifySignalCrmContact({
    mutation: {
      onSuccess: (updatedSignal) => {
        queryClient.setQueryData(getGetSignalQueryKey(signal.id), updatedSignal);
        setCrmQuery("");
        toast({ title: "CRM-kontakt verifisert", description: "Denne kontakten kan nå motta notat og oppgave." });
      },
      onError: (error) => toast({
        title: "Kontakten kunne ikke verifiseres",
        description: error instanceof Error ? error.message : "Kontroller at kontakten tilhører riktig selskap.",
        variant: "destructive",
      }),
    },
  });

  const reviewMutation = useReviewSignal({
    mutation: {
      onSuccess: (updatedSignal) => {
        // Update local cache
        queryClient.setQueryData(getGetSignalQueryKey(signal.id), updatedSignal);
        // Invalidate lists
        queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        
        toast({
          title: "Signal oppdatert",
          description: `Status satt til ${updatedSignal.status.replace('_', ' ')}`,
        });
      },
      onError: () => {
        toast({
          title: "Noe gikk galt",
          description: "Signalstatusen kunne ikke oppdateres",
          variant: "destructive",
        });
      }
    }
  });

  const crmMutation = useCreateCrmTask({
    mutation: {
      onSuccess: () => {
        toast({
          title: "CRM-oppgave opprettet",
          description: "Oppgaven og notatet er synkronisert til CRM",
        });
        queryClient.invalidateQueries({ queryKey: getGetSignalQueryKey(signal.id) });
      },
      onError: () => {
        toast({
          title: "Noe gikk galt",
          description: "CRM-oppgaven kunne ikke opprettes",
          variant: "destructive",
        });
      }
    }
  });

  const handleReview = (status: SignalReviewInputStatus) => {
    reviewMutation.mutate({
      id: signal.id,
      data: {
        status,
        comment: comment || undefined
      }
    });
  };

  const handleCreateTask = () => {
    const selected = signal.contacts.find((contact) => contact.id === contactId);
    if (!selected?.crmContactId) {
      toast({
        title: "CRM-kontakt mangler",
        description: "Søk etter og verifiser riktig CRM-kontakt før du oppretter en oppgave.",
        variant: "destructive"
      });
      return;
    }
    crmMutation.mutate({
      id: signal.id,
      data: {
        contactId: selected.id,
        dueDate: format(addDays(new Date(), 2), 'yyyy-MM-dd')
      }
    });
  };

  const isPending = signal.status === 'til_vurdering';
  const isApproved = signal.status === 'godkjent';

  return (
    <Card className={`border-2 ${isPending ? 'border-primary shadow-md' : 'border-border'}`}>
      <CardHeader className="pb-3 bg-secondary/30 rounded-t-xl">
        <CardTitle className="text-base flex items-center justify-between">
          {isPending ? "Velg neste steg" : "Status"}
          {isApproved && <Badge variant="default">Godkjent</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4 pt-4">
        {isPending ? (
          <>
            <Textarea 
               placeholder="Legg til valgfri kontekst eller begrunnelse..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="resize-none h-20 text-sm bg-background"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button 
                variant="default" 
                className="w-full"
                onClick={() => handleReview('godkjent')}
                disabled={reviewMutation.isPending}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Godkjenn
              </Button>
              <Button 
                variant="outline" 
                className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleReview('avvist')}
                disabled={reviewMutation.isPending}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Avvis
              </Button>
              <Button 
                variant="secondary" 
                className="w-full col-span-2"
                onClick={() => handleReview('følg_videre')}
                disabled={reviewMutation.isPending}
              >
                <Clock className="w-4 h-4 mr-2" />
                Følg videre
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="text-sm p-3 bg-secondary rounded-lg">
               Status satt til <strong className="capitalize">{signal.status.replace('_', ' ')}</strong>
              {signal.reviewComment && (
                <div className="mt-2 text-muted-foreground border-l-2 border-border pl-2 italic">
                  "{signal.reviewComment}"
                </div>
              )}
            </div>
            
            {isApproved && (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verifiser mottaker</div>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={contactId ?? ""}
                    onChange={(event) => setContactId(Number(event.target.value))}
                  >
                    <option value="" disabled>Velg anbefalt kontakt</option>
                    {signal.contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name} — {contact.title}{contact.crmContactId ? " (CRM verifisert)" : ""}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Søk navn eller e-post i CRM"
                    value={crmQuery}
                    onChange={(event) => setCrmQuery(event.target.value)}
                  />
                  {crmSearch.isFetching && <div className="text-xs text-muted-foreground">Søker i CRM...</div>}
                  {crmSearch.data?.map((candidate) => (
                    <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{candidate.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {candidate.title || "Uten tittel"}{candidate.email ? ` · ${candidate.email}` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verifyContactMutation.isPending || contactId === null}
                        onClick={() => verifyContactMutation.mutate({
                          id: signal.id,
                          data: { contactId: contactId as number, crmContactId: candidate.id },
                        })}
                      >
                        Koble
                      </Button>
                    </div>
                  ))}
                  {signal.contacts.find((contact) => contact.id === contactId)?.crmContactId && (
                    <div className="text-xs text-primary">CRM-match verifisert. Ingen CRM-skriving skjer før du trykker opprett.</div>
                  )}
                </div>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={handleCreateTask}
                  disabled={crmMutation.isPending || !signal.contacts.find((contact) => contact.id === contactId)?.crmContactId}
                >
                  <CheckSquare className="w-4 h-4 mr-2" />
                  {crmMutation.isPending ? 'Synkroniserer...' : 'Opprett CRM-oppgave'}
                </Button>
                {signal.crm.writeStatus && (
                  <div className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Revisjonsstatus:</span>{" "}
                    {signal.crm.writeStatus === "completed" && "Notat og oppgave lagret"}
                    {signal.crm.writeStatus === "pending" && "Skriver til CRM"}
                    {signal.crm.writeStatus === "partial" && "Notat lagret, oppgave må kontrolleres i CRM"}
                    {signal.crm.writeStatus === "failed" && "CRM-skriving feilet — ingen komplett synkronisering"}
                    {signal.crm.writeStatus === "not_started" && "Ikke skrevet til CRM ennå"}
                  </div>
                )}
              </div>
            )}

            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full text-muted-foreground"
              onClick={() => handleReview('til_vurdering')}
              disabled={reviewMutation.isPending}
            >
               Angre vurdering
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      <div className="h-14 border-b border-border flex items-center px-6">
        <Skeleton className="h-6 w-64" />
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 p-6 space-y-6">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="w-[400px] border-l border-border p-6 space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}

function DetailError() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <XCircle className="w-12 h-12 text-destructive mx-auto" />
        <h2 className="text-xl font-bold">Signal not found</h2>
        <p className="text-muted-foreground">The signal you are looking for does not exist or has been removed.</p>
        <Link href="/">
          <a className="inline-flex items-center text-primary hover:underline">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Inbox
          </a>
        </Link>
      </div>
    </div>
  );
}
