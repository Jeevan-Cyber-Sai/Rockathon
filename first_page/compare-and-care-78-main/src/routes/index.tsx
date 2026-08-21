import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BagIntro } from "@/components/BagIntro";
import logo from "@/assets/shopyx-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shopyx — Compare prices across Amazon, Flipkart & Croma" },
      {
        name: "description",
        content:
          "Tell Shopyx what you need in plain words. We compare price, delivery, seller rating, stock and reviews across every major store and hand you the best buy.",
      },
      { property: "og:title", content: "Shopyx — One search. Every store." },
      {
        property: "og:description",
        content:
          "Shopyx compares price, delivery, seller rating, stock and reviews across Amazon, Flipkart, Croma and more.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const STORES = [
  { name: "Amazon", domain: "amazon.in" },
  { name: "Flipkart", domain: "flipkart.com" },
  { name: "Croma", domain: "croma.com" },
  { name: "Reliance Digital", domain: "reliancedigital.in" },
  { name: "Vijay Sales", domain: "vijaysales.com" },
  { name: "Tata Cliq", domain: "tatacliq.com" },
];

const SIGNALS = [
  { label: "Price", note: "landed cost after coupons and shipping" },
  { label: "Delivery time", note: "real ETA to your pincode" },
  { label: "Seller rating", note: "the seller, not just the brand" },
  { label: "Stock", note: "quantity fulfillable today" },
  { label: "Review count", note: "volume weighted by quality" },
  { label: "Returns", note: "window, pickup and refund friction" },
];

function Index() {
  const [introDone, setIntroDone] = useState(false);

  return (
    <>
      {!introDone && <BagIntro onDone={() => setIntroDone(true)} />}

      <main
        className={`mesh-bg grid-veil relative min-h-screen overflow-hidden ${
          introDone ? "opacity-100" : "opacity-0"
        } transition-opacity duration-700`}
      >
        <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <img src={logo.url} alt="Shopyx" className="h-14 w-auto md:h-16" />
          <nav className="hidden items-center gap-9 text-sm text-brand-ink/70 md:flex">
            <a className="story-link" href="#how">
              How it works
            </a>
            <a className="story-link" href="#signals">
              What we compare
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

        <section className="relative mx-auto w-full max-w-6xl px-6 pt-14 pb-24 md:pt-24">
          <p className="rise text-xs uppercase tracking-[0.38em] text-brand/80">
            price intelligence for real buyers
          </p>

          <h1 className="rise mt-7 max-w-4xl text-5xl leading-[0.95] text-brand-ink md:text-7xl">
            Say what you need.
            <br />
            We&rsquo;ll find where it&rsquo;s
            <span className="text-brand"> actually</span> worth buying.
          </h1>

          <p className="rise mt-7 max-w-xl text-lg leading-relaxed text-brand-ink/70">
            Shopyx reads a request like &ldquo;10 HP laptops, 16GB RAM, under &#8377;65,000,
            delivered by Friday&rdquo; and pulls every matching listing across the big
            marketplaces — then ranks them on the things that decide a purchase.
          </p>

          <div className="rise mt-10 flex flex-wrap items-center gap-4">
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

          <div className="rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-brand-ink/50">
            <span>Bulk quantities supported</span>
            <span className="h-1 w-1 rounded-full bg-brand/40" />
            <span>Pincode-aware delivery estimates</span>
            <span className="h-1 w-1 rounded-full bg-brand/40" />
            <span>No affiliate reordering</span>
          </div>
        </section>

        <section id="stores" className="relative border-y border-hairline/70 bg-surface/40">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-4 px-6 py-6">
            <span className="text-xs uppercase tracking-[0.3em] text-brand-ink/35">
              Sourced from
            </span>
            {STORES.map((s) => (
              <span
                key={s.name}
                className="flex items-center gap-2 text-sm tracking-wide text-brand-ink/55"
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

        <section id="signals" className="relative mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="max-w-xl text-2xl text-brand-ink md:text-3xl">
            Six signals we score on every listing, in every category.
          </h2>
          <div className="mt-7 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline/60 sm:grid-cols-2 lg:grid-cols-3">
            {SIGNALS.map((s, i) => (
              <div key={s.label} className="bg-surface/85 px-5 py-4">
                <span className="text-[0.65rem] tabular-nums text-brand/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-1 text-base text-brand-ink">{s.label}</h3>
                <p className="mt-1 text-xs leading-relaxed text-brand-ink/55">{s.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="relative mx-auto w-full max-w-6xl px-6 pb-28">
          <div className="grid gap-14 md:grid-cols-3">
            {[
              {
                t: "Write it like you'd say it",
                d: "Quantity, specs, budget, deadline. No filters, no dropdowns, no tab-hopping.",
              },
              {
                t: "We pull the live listings",
                d: "Matching products from each marketplace, with seller, stock and delivery resolved to your address.",
              },
              {
                t: "One ranked answer",
                d: "A single table showing where to buy, what it lands at, and what you trade off if you go cheaper.",
              },
            ].map((step, i) => (
              <div key={step.t} className="border-t border-hairline pt-6">
                <span className="text-xs tabular-nums tracking-[0.3em] text-brand/60">
                  STEP {i + 1}
                </span>
                <h3 className="mt-4 text-2xl text-brand-ink">{step.t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-brand-ink/60">{step.d}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="relative border-t border-hairline">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 text-sm text-brand-ink/45 sm:flex-row sm:items-center">
            <span>Shopyx</span>
            <span>Comparison results are ranked on merit, never on commission.</span>
          </div>
        </footer>
      </main>
    </>
  );
}
