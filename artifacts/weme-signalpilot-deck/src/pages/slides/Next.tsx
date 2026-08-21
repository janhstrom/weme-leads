export default function Next() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text">
      <div className="absolute inset-y-0 left-0 w-[36vw] bg-primary" />
      <div className="relative flex h-full">
        <div className="flex w-[36vw] flex-col justify-between px-[7vw] py-[8vh] text-[#f4f0e8]">
          <p className="font-body text-[1.5vw] font-bold uppercase tracking-[0.16em] text-accent">04 / Neste steg</p>
          <div>
            <p className="font-display text-[5.2vw] font-semibold leading-[0.92] tracking-[-0.07em]">Fra pilot<br />til praksis</p>
            <div className="mt-[4vh] h-[0.3vw] w-[7vw] bg-accent" />
          </div>
          <p className="font-body text-[1.5vw] leading-[1.3] text-[#f4f0e8]/60">Hold v1 lett: mennesket godkjenner, systemet gjør forarbeidet.</p>
        </div>
        <div className="flex flex-1 flex-col justify-center px-[7vw] py-[8vh]">
          <div className="space-y-[3.3vh]">
            <div className="flex items-start gap-[2vw]">
              <span className="font-display text-[2.1vw] font-semibold text-accent">01</span>
              <p className="max-w-[42vw] font-body text-[2vw] leading-[1.15]">Importer kontoer fra eksisterende baseline- og CRM-grunnlag</p>
            </div>
            <div className="flex items-start gap-[2vw]">
              <span className="font-display text-[2.1vw] font-semibold text-accent">02</span>
              <p className="max-w-[42vw] font-body text-[2vw] leading-[1.15]">Erstatt pilotfixture med ferske, direkte verifiserte kilder</p>
            </div>
            <div className="flex items-start gap-[2vw]">
              <span className="font-display text-[2.1vw] font-semibold text-accent">03</span>
              <p className="max-w-[42vw] font-body text-[2vw] leading-[1.15]">Koble signaler til riktige CRM-kontakter</p>
            </div>
            <div className="flex items-start gap-[2vw]">
              <span className="font-display text-[2.1vw] font-semibold text-accent">04</span>
              <p className="max-w-[42vw] font-body text-[2vw] leading-[1.15]">Validér notat- og oppgaveflyten mot CRM-kontrakten</p>
            </div>
          </div>
          <div className="mt-[8vh] border-t-[0.14vw] border-primary/20 pt-[3vh]">
            <p className="font-display text-[2.05vw] font-semibold leading-[1.1]">Neste beslutning: hvilke pilotkontoer skal verifiseres først?</p>
          </div>
        </div>
      </div>
    </div>
  );
}