const base = import.meta.env.BASE_URL;

export default function Title() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-primary text-[#f4f0e8]">
      <img
        src={`${base}signalpilot-hero.png`}
        crossOrigin="anonymous"
        alt="Abstrakt kart over kundesignaler"
        className="absolute inset-0 h-full w-full object-cover opacity-80"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(22,34,53,0.98)_0%,rgba(22,34,53,0.78)_42%,rgba(22,34,53,0.2)_100%)]" />
      <div className="absolute left-[7vw] top-[7vh] flex items-center gap-[1vw] text-[1.5vw] font-body font-medium tracking-[0.12em] uppercase text-[#f4f0e8]/70">
        <span className="h-[0.8vw] w-[0.8vw] rounded-full bg-accent" />
        WeMe · intern prosjektpresentasjon
      </div>
      <div className="relative z-10 flex h-full w-[62vw] flex-col justify-center pl-[7vw]">
        <div className="mb-[3vh] w-[8vw] border-t-[0.35vw] border-accent" />
        <h1 className="max-w-[55vw] font-display text-[7.2vw] font-semibold leading-[0.92] tracking-[-0.07em] text-wrap-balance">
        WeMe<br />Leads
        </h1>
        <p className="mt-[4vh] max-w-[43vw] font-body text-[2.1vw] leading-[1.18] text-[#f4f0e8]/85">
          Fra statiske lister til ferske, verifiserte kundesignaler
        </p>
        <p className="mt-[2vh] max-w-[38vw] font-body text-[1.5vw] leading-[1.35] text-[#f4f0e8]/65">
          En lett arbeidsflate for å finne riktig tidspunkt, riktig kontakt og riktig inngang.
        </p>
      </div>
      <div className="absolute bottom-[7vh] right-[7vw] font-body text-[1.5vw] tracking-[0.08em] text-[#f4f0e8]/55">
        WEME LEADS / V1
      </div>
    </div>
  );
}