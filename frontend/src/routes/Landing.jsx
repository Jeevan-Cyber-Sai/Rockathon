import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import BagIntro from "../components/BagIntro";

/**
 * The landing page, ported from the supplied first_page design.
 *
 * One departure from the source: it used TanStack Router's file-route +
 * head() API, and this app is on react-router-dom, so the title is set
 * directly. Everything else - copy, layout, both CTAs pointing at /login -
 * matches the folder.
 */

const STORES = [
  { name: "Amazon", domain: "amazon.in" },
  { name: "Flipkart", domain: "flipkart.com" },
  { name: "Croma", domain: "croma.com" },
  { name: "Reliance Digital", domain: "reliancedigital.in" },
  { name: "Vijay Sales", domain: "vijaysales.com" },
  { name: "Tata Cliq", domain: "tatacliq.com" },
];

const SIGNALS = [
  { label: "Price", note: "True cost after coupons" },
  { label: "Delivery", note: "Real pincode ETA" },
  { label: "Seller Score", note: "Verified merchant rating" },
  { label: "Live Stock", note: "Instant inventory check" },
  { label: "Reviews", note: "Quality-weighted sentiment" },
  { label: "Returns", note: "Hassle-free policy check" },
];

const STEPS = [
  {
    t: "Ask naturally",
    d: "Type specs, budget, or bulk quantity in plain words.",
  },
  {
    t: "Live scan",
    d: "We pull real-time pricing and stock across top stores.",
  },
  {
    t: "Ranked results",
    d: "Pick the best deal with zero hidden trade-offs.",
  },
];

// Opacity only, deliberately: `transform` (and `filter`) on an ancestor makes
// it the containing block for any `position: fixed` descendant, which would
// break the full-screen intro overlay. Fading alone creates only a stacking
// context, which is harmless here.
const landingVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.4 } },
  exit: { opacity: 0, transition: { duration: 0.22 } },
};

export default function Landing() {
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    document.title = "Shopyx — Compare prices across Amazon, Flipkart & Croma";
  }, []);

  return (
    <>
      {!introDone && <BagIntro onDone={() => setIntroDone(true)} />}

      <motion.main
        variants={landingVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className={
          "landing mesh-bg grid-veil relative min-h-screen overflow-hidden " +
          (introDone ? "opacity-100" : "opacity-0") +
          " transition-opacity duration-700"
        }
      >
        <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <img src="/logo-full.png" alt="Shopyx" className="h-14 w-auto md:h-16" />
          <nav className="hidden items-center gap-9 text-sm text-brand-ink/70 md:flex">
            <a className="story-link" href="#how">
              How it works
            </a>
            <a className="story-link" href="#signals">
              Signals
            </a>
            <a className="story-link" href="#stores">
              Stores
            </a>
          </nav>
          <Link
            to="/login"
            className="rounded-full bg-brand-deep px-6 py-2.5 text-sm font-medium text-cream shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5"
          >
            Log in
          </Link>
        </header>

        <section className="relative mx-auto w-full max-w-6xl px-6 pt-12 pb-20 md:pt-20">
          <p className="rise text-xs uppercase tracking-[0.35em] text-brand font-medium">
            Smart Multi-Store Shopping
          </p>

          <h1 className="rise mt-6 max-w-4xl text-5xl leading-[1] text-brand-ink md:text-7xl">
            Say what you need.
            <br />
            Find the <span className="text-brand">best deal</span> instantly.
          </h1>

          <p className="rise mt-6 max-w-xl text-base md:text-lg leading-relaxed text-brand-ink/70">
            Compare live prices, delivery times, and verified sellers across Amazon, Flipkart, Croma, and more — in one search.
          </p>

          <div className="rise mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/login"
              className="rounded-xl bg-brand px-7 py-3.5 text-sm font-medium text-cream shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5"
            >
              Get started
            </Link>
            <a
              href="#how"
              className="rounded-xl border border-hairline bg-surface/70 px-7 py-3.5 text-sm text-brand-ink/75 backdrop-blur transition-transform hover:-translate-y-0.5"
            >
              See how it works
            </a>
          </div>

          <div className="rise mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs md:text-sm text-brand-ink/55">
            <span>⚡ Bulk quantities</span>
            <span className="h-1 w-1 rounded-full bg-brand/40" />
            <span>🚚 Live pincode ETAs</span>
            <span className="h-1 w-1 rounded-full bg-brand/40" />
            <span>🛡️ Zero sponsored bias</span>
          </div>
        </section>

        <section id="stores" className="relative border-y border-hairline/70 bg-surface/40">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-4 px-6 py-5">
            <span className="text-xs uppercase tracking-[0.25em] text-brand-ink/40 font-medium">
              Sourced from
            </span>
            {STORES.map((s) => (
              <span
                key={s.name}
                className="flex items-center gap-2 text-sm tracking-wide text-brand-ink/60"
              >
                <img
                  src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=64`}
                  alt={`${s.name} logo`}
                  loading="lazy"
                  width={20}
                  height={20}
                  className="h-5 w-5 rounded-[5px] bg-surface object-contain shadow-[0_1px_4px_oklch(0.24_0.09_292/0.15)]"
                />
                {s.name}
              </span>
            ))}
          </div>
        </section>

        <section id="signals" className="relative mx-auto w-full max-w-6xl px-6 py-14">
          <h2 className="text-2xl text-brand-ink md:text-3xl">
            Key Signals We Compare
          </h2>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline/60 sm:grid-cols-2 lg:grid-cols-3">
            {SIGNALS.map((s, i) => (
              <div key={s.label} className="bg-surface/85 px-5 py-4">
                <span className="text-[0.65rem] tabular-nums text-brand/60 font-semibold">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-1 text-base font-medium text-brand-ink">{s.label}</h3>
                <p className="mt-0.5 text-xs text-brand-ink/55">{s.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="relative mx-auto w-full max-w-6xl px-6 pb-20">
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.t} className="border-t border-hairline pt-5">
                <span className="text-xs tabular-nums tracking-[0.25em] text-brand font-semibold">
                  0{i + 1}
                </span>
                <h3 className="mt-2 text-xl text-brand-ink">{step.t}</h3>
                <p className="mt-1.5 text-sm text-brand-ink/60">{step.d}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="relative border-t border-hairline">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 text-xs text-brand-ink/45">
            <span>Shopyx</span>
            <span>Ranked on merit & true cost.</span>
          </div>
        </footer>
      </motion.main>
    </>
  );
}
