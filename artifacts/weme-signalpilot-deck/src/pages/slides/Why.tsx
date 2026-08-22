export default function Why() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text">
      <div className="absolute left-0 top-0 h-full w-[1.1vw] bg-accent" />
      <div className="absolute right-[-10vw] top-[-18vh] h-[52vw] w-[52vw] rounded-full border-[0.12vw] border-primary/10" />
      <div className="absolute right-[-3vw] top-[-10vh] h-[38vw] w-[38vw] rounded-full border-[0.12vw] border-accent/20" />
      <div className="relative flex h-full flex-col px-[8vw] py-[8vh]">
        <p className="font-body text-[1.5vw] font-bold uppercase tracking-[0.16em] text-accent">01 / Utgangspunkt</p>
        <h1 className="mt-[2vh] max-w-[70vw] font-display text-[4.3vw] font-semibold leading-[0.98] tracking-[-0.06em]">
          Hvorfor WeMe Leads?
        </h1>
        <div className="mt-[8vh] grid max-w-[78vw] grid-cols-2 gap-x-[6vw] gap-y-[5vh]">
          <div className="border-t-[0.16vw] border-primary/25 pt-[2vh]">
            <p className="font-display text-[2.15vw] font-semibold leading-[1.05]">Hvem passer?</p>
            <p className="mt-[1.5vh] font-body text-[2vw] leading-[1.2] text-muted">D&amp;B- og Sales Navigator-lister viser hvem som passer ICP — ikke hvorfor nå</p>
          </div>
          <div className="border-t-[0.16vw] border-primary/25 pt-[2vh]">
            <p className="font-display text-[2.15vw] font-semibold leading-[1.05]">Hva skjer nå?</p>
            <p className="mt-[1.5vh] font-body text-[2vw] leading-[1.2] text-muted">CRM viser relasjon og eksklusjon — ikke fersk endring</p>
          </div>
          <div className="border-t-[0.16vw] border-primary/25 pt-[2vh]">
            <p className="font-display text-[2.15vw] font-semibold leading-[1.05]">Hvorfor tror vi det?</p>
            <p className="mt-[1.5vh] font-body text-[2vw] leading-[1.2] text-muted">Offentlige signaler må kobles til kilde, dato, sitat og kontaktvinkel</p>
          </div>
          <div className="border-t-[0.16vw] border-accent pt-[2vh]">
            <p className="font-display text-[2.15vw] font-semibold leading-[1.05]">Hva må verktøyet være?</p>
            <p className="mt-[1.5vh] font-body text-[2vw] leading-[1.2] text-muted">Et lite team trenger en arbeidsflyt, ikke en ny salgsplattform</p>
          </div>
        </div>
        <div className="mt-auto flex items-center gap-[1.5vw] font-body text-[1.5vw] text-muted">
          <span className="h-[0.7vw] w-[0.7vw] rounded-full bg-accent" />
          Fra statisk konto-univers til beslutningsklart signal
        </div>
      </div>
    </div>
  );
}