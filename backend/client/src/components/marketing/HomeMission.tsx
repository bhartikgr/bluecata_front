import portrait from "@/assets/marketing/ozan-isinak.webp";

export default function HomeMission() {
  return (
    <section className="home-mission" id="mission" aria-labelledby="home-mission-heading" data-testid="home-mission">
      <div className="home-mission__inner">
        <header className="home-mission__header">
          <div className="eyebrow"><span className="eyebrow__dot" />Our mission</div>
          <h2 id="home-mission-heading">Your network is your real asset.</h2>
        </header>
        <div className="home-mission__grid">
          <figure className="home-mission__portrait">
            <img
              src={portrait}
              alt="Ozan Isinak speaking at an event"
              width={790}
              height={956}
              loading="lazy"
              decoding="async"
            />
            <figcaption>
              <span className="home-mission__name">Ozan Isinak</span>
              <a href="https://www.linkedin.com/in/ozanisinak/" target="_blank" rel="noopener noreferrer">
                LinkedIn profile <span aria-hidden="true">↗</span>
              </a>
            </figcaption>
          </figure>
          <div className="home-mission__copy" data-testid="home-mission-copy">
            <p>Capavate draws on our decades of early-stage investing experience across the globe. Platforms are, and should be, simple tools. Your network, and your ability to build trusted relationships within it as your business and investments grow, is your real asset.</p>
            <p>Too often, founders, investors, and ecosystem partners work through disconnected tools. Our experience has taught us that this fragmentation gets in the way. These participants have distinct needs but interconnected responsibilities that cannot be managed effectively in isolation. Our mission is to bring them together in Capavate, working from consistent information, clear responsibilities, and controlled access. Every round should build on the relationships and records of the last, not start over.</p>
            <p>Capavate is the shared infrastructure for founders raising capital, investors backing businesses, and Consortium Partners bringing them together. Founders manage their rounds, ownership, and investor relationships. Investors can connect directly with fellow investors on the register, share insights, and offer constructive advice to founders, while maintaining a clear record of their investments. Consortium Partners qualify their pipelines, manage clients’ raises, and launch their own SPVs. This is how companies scale, networks grow stronger, and ecosystems thrive.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
