export default function Workflow() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text">
      <div className="absolute right-[7vw] top-[6vh] font-body text-[1.5vw] font-bold uppercase tracking-[0.16em] text-accent">02 / Arbeidsflyt</div>
      <div className="flex h-full flex-col px-[8vw] py-[8vh]">
        <h1 className="max-w-[65vw] font-display text-[4.3vw] font-semibold leading-[0.98] tracking-[-0.06em]">
          Arbeidsflyten
        </h1>
        <p className="mt-[2vh] max-w-[50vw] font-body text-[2vw] leading-[1.2] text-muted">
          Systemet gjør forarbeidet. Mennesket beholder vurderingen.
        </p>
        <div className="mt-[8vh] flex items-stretch gap-[1vw]">
          <div className="flex h-[28vh] flex-1 flex-col justify-between bg-primary p-[2vw] text-[#f4f0e8]">
            <span className="font-body text-[1.5vw] font-bold text-accent">01</span>
            <p className="font-display text-[2.15vw] font-semibold leading-[1.02]">Konto-<br />univers</p>
            <p className="font-body text-[1.5vw] text-[#f4f0e8]/65">ICP og historikk</p>
          </div>
          <div className="flex h-[28vh] flex-1 flex-col justify-between border-[0.12vw] border-primary/25 bg-[#ebe6dc] p-[2vw]">
            <span className="font-body text-[1.5vw] font-bold text-accent">02</span>
            <p className="font-display text-[2.15vw] font-semibold leading-[1.02]">Signal-<br />søk</p>
            <p className="font-body text-[1.5vw] text-muted">Offentlige endringer</p>
          </div>
          <div className="flex h-[28vh] flex-1 flex-col justify-between border-[0.12vw] border-primary/25 bg-[#ebe6dc] p-[2vw]">
            <span className="font-body text-[1.5vw] font-bold text-accent">03</span>
            <p className="font-display text-[2.15vw] font-semibold leading-[1.02]">Kilde-<br />verifisering</p>
            <p className="font-body text-[1.5vw] text-muted">Dato, sitat, ferskhet</p>
          </div>
          <div className="flex h-[28vh] flex-1 flex-col justify-between border-[0.12vw] border-primary/25 bg-[#ebe6dc] p-[2vw]">
            <span className="font-body text-[1.5vw] font-bold text-accent">04</span>
            <p className="font-display text-[2.15vw] font-semibold leading-[1.02]">CRM-<br />sjekk</p>
            <p className="font-body text-[1.5vw] text-muted">Unngå konflikt</p>
          </div>
        </div>
        <div className="mt-[4vh] flex items-center gap-[1vw]">
          <div className="h-[0.22vw] flex-1 bg-primary/20" />
          <div className="h-[1.2vw] w-[1.2vw] rounded-full bg-accent" />
          <div className="h-[0.22vw] flex-1 bg-primary/20" />
        </div>
        <div className="mt-[4vh] flex items-center justify-between">
          <p className="max-w-[38vw] font-body text-[2vw] leading-[1.2] text-muted">Menneskelig vurdering: godkjenn, avvis eller følg videre</p>
          <p className="max-w-[32vw] text-right font-display text-[2.35vw] font-semibold leading-[1.05]">Godkjent signal → CRM-notat og oppgave</p>
        </div>
        <div className="mt-auto font-body text-[1.5vw] text-muted">Feedback gjør neste vurdering bedre</div>
      </div>
    </div>
  );
}