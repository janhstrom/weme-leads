export default function Ready() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text">
      <div className="absolute left-[8vw] top-[7vh] font-body text-[1.25vw] font-bold uppercase tracking-[0.16em] text-accent">03 / Status</div>
      <div className="absolute bottom-[-15vw] right-[-10vw] h-[45vw] w-[45vw] rounded-full border-[0.16vw] border-accent/20" />
      <div className="absolute bottom-[-8vw] right-[-3vw] h-[30vw] w-[30vw] rounded-full border-[0.16vw] border-primary/10" />
      <div className="relative flex h-full flex-col px-[8vw] py-[8vh]">
        <h1 className="max-w-[70vw] font-display text-[4.3vw] font-semibold leading-[0.98] tracking-[-0.06em]">
          Førsteversjonen er klar
        </h1>
        <div className="mt-[7vh] grid max-w-[78vw] grid-cols-3 gap-[1.2vw]">
          <div className="col-span-2 bg-primary p-[2vw] text-[#f4f0e8]">
            <div className="flex items-end justify-between">
              <p className="font-display text-[7vw] font-semibold leading-none tracking-[-0.08em]">01</p>
              <p className="font-body text-[1.25vw] uppercase tracking-[0.12em] text-[#f4f0e8]/60">Signalinnboks</p>
            </div>
            <p className="mt-[3vh] max-w-[42vw] font-body text-[1.7vw] leading-[1.2]">Signalinnboks med søk, status og A/B/C-prioritet</p>
          </div>
          <div className="bg-[#ebe6dc] p-[2vw]">
            <p className="font-display text-[4.7vw] font-semibold leading-none tracking-[-0.08em] text-accent">02</p>
            <p className="mt-[3vh] font-body text-[1.55vw] leading-[1.2]">Detaljvisning med kilde, ferskhet, sitat og endringsrelevans</p>
          </div>
          <div className="border-[0.12vw] border-primary/25 bg-[#ebe6dc] p-[2vw]">
            <p className="font-display text-[4.7vw] font-semibold leading-none tracking-[-0.08em]">03</p>
            <p className="mt-[3vh] font-body text-[1.55vw] leading-[1.2]">Anbefalt kontakt, åpningsspørsmål og dialogutkast</p>
          </div>
          <div className="border-[0.12vw] border-primary/25 bg-[#ebe6dc] p-[2vw]">
            <p className="font-display text-[4.7vw] font-semibold leading-none tracking-[-0.08em]">04</p>
            <p className="mt-[3vh] font-body text-[1.55vw] leading-[1.2]">Persistente signaler og review-feedback i databasen</p>
          </div>
          <div className="border-[0.12vw] border-accent bg-[#ebe6dc] p-[2vw]">
            <p className="font-display text-[4.7vw] font-semibold leading-none tracking-[-0.08em] text-accent">05</p>
            <p className="mt-[3vh] font-body text-[1.55vw] leading-[1.2]">CRM-skriving er sperret til signal og kontakt er godkjent og verifisert</p>
          </div>
        </div>
        <div className="mt-auto flex items-center gap-[1.5vw] font-body text-[1.3vw] text-muted">
          <span className="h-[0.7vw] w-[0.7vw] rounded-full bg-accent" />
          Bygget for å gjøre neste gode beslutning enklere
        </div>
      </div>
    </div>
  );
}