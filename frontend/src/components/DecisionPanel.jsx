import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { spring } from "../lib/motion";

const rupees = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

/** Small image with a skeleton while loading and a graceful fallback when
 * the URL is null or 404s. Same treatment as the product cards. */
function Thumb({ src, alt, className = "" }) {
  const [state, setState] = useState(src ? "loading" : "failed");
  return (
    <div className={"relative shrink-0 overflow-hidden rounded-xl bg-ink/[0.04] " + className}>
      {state === "loading" && <div className="absolute inset-0 animate-pulse bg-ink/[0.06]" />}
      {state !== "failed" && (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-contain"
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      )}
      {state === "failed" && (
        <div className="grid h-full w-full place-items-center text-[10px] text-ink/25 font-body">
          no image
        </div>
      )}
    </div>
  );
}

function BuyLink({ url, children, className = "" }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

/** The winning line, presented as the answer: image, title, unit price, the
 * per-order total it implies, and a direct link to the listing. */
function FinalPick({ line, totalCost, latestDelivery, lineCount }) {
  return (
    <div className="mt-4 rounded-2xl border border-violet/25 bg-violet/[0.04] p-4 sm:p-5">
      <div className="flex gap-4">
        <Thumb src={line.image_url} alt={line.title} className="h-24 w-24 bg-panel" />

        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-semibold text-ink font-body">
            {line.title}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/50 font-body">
            <span className="uppercase tracking-wide">{line.source}</span>
            {line.delivery_days != null && <span>{line.delivery_days}d delivery</span>}
            {line.rating != null && (
              <span>
                ★ {line.rating}
                {line.rating_count ? ` (${line.rating_count.toLocaleString("en-IN")})` : ""}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="text-2xl font-bold text-ink font-display">
                {rupees(line.unit_price)}
              </span>
              <span className="text-xs text-ink/40 font-body"> each × {line.qty}</span>
              {lineCount === 1 && (
                <div className="text-xs text-ink/50 font-body mt-0.5">
                  {rupees(totalCost)} total
                  {latestDelivery != null && ` · arrives within ${latestDelivery} days`}
                </div>
              )}
            </div>

            <BuyLink
              url={line.url}
              className="rounded-lg border border-violet/40 px-4 py-2 text-xs font-semibold
                         text-violet-deep transition-colors hover:bg-violet/10"
            >
              View on {line.source} ↗
            </BuyLink>
          </div>

          {line.quantity_assumed && (
            <p className="mt-2 text-[11px] text-ink/35 font-body">
              {line.source} doesn&rsquo;t publish a unit count for this listing, so the
              quantity is assumed available rather than vendor-confirmed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** What the winner beat, and by how much over the whole order. */
function Comparison({ alternatives, winnerPrice }) {
  if (!alternatives?.length) return null;
  // Defensive: the backend already dedupes by (source, product_id), but a
  // repeated listing here would otherwise render twice with a duplicate
  // React key, so this stays as a second line of defence.
  const seen = new Set();
  alternatives = alternatives.filter((a) => {
    const k = `${a.source}:${a.product_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <div className="mt-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40 font-body">
        Compared against
      </h3>

      <div className="mt-2 divide-y divide-edge overflow-hidden rounded-xl border border-edge">
        {alternatives.map((alt) => (
          <div
            key={`${alt.source}:${alt.product_id}`}
            className="flex items-center gap-3 bg-panel px-3 py-2.5"
          >
            <Thumb src={alt.image_url} alt={alt.title} className="h-10 w-10" />

            <div className="min-w-0 flex-1">
              <BuyLink
                url={alt.url}
                className="block truncate text-xs text-ink/70 font-body hover:text-violet-deep hover:underline"
              >
                {alt.title}
              </BuyLink>
              <div className="flex items-center gap-2 text-[11px] text-ink/35 font-body">
                <span>{rupees(alt.unit_price)} each</span>
                {alt.delivery_days != null && <span>· {alt.delivery_days}d</span>}
                {alt.rating != null && <span>· ★ {alt.rating}</span>}
              </div>
            </div>

            <span className="shrink-0 text-xs font-semibold text-rose-700 font-body">
              {alt.extra_total > 0
                ? `+${rupees(alt.extra_total)}`
                : `+${rupees(Math.max(alt.unit_price - winnerPrice, 0))}`}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-ink/35 font-body">
        Difference shown is what the whole order would have cost extra with that
        listing instead.
      </p>
    </div>
  );
}

/** Feature B: one honest sentence of price context, from real numbers
 * computed backend-side (price_context() in core/engine.py) over the
 * listings actually fetched for this run - never estimated client-side. */
function PriceContext({ ctx }) {
  const { chosen_price, min_price, avg_price, qualifying_count, is_lowest } = ctx;
  return (
    <p className="mt-4 text-xs text-ink/45 font-body">
      Chosen price: <span className="font-semibold text-ink/70">{rupees(chosen_price)}</span>.{" "}
      {is_lowest ? (
        <span className="text-emerald-700 font-medium">This is the lowest price found today.</span>
      ) : (
        <>
          Lowest seen today: {rupees(min_price)}. Average across {qualifying_count} qualifying
          listing{qualifying_count === 1 ? "" : "s"}: {rupees(avg_price)}.
        </>
      )}
    </p>
  );
}

function LineItem({ line }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-edge last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-ink/90 font-body truncate">{line.title}</p>
        <p className="text-xs text-ink/40 font-body">
          {line.source} · qty {line.qty} ·{" "}
          {line.delivery_days != null ? `${line.delivery_days}d delivery` : "delivery unknown"}
        </p>
      </div>
      <span className="shrink-0 text-sm text-ink font-semibold font-body">
        {rupees(line.unit_price)}
        <span className="text-ink/30"> ea</span>
      </span>
    </div>
  );
}

function Allocation({ allocation }) {
  return (
    <div className="mt-2">
      {allocation.lines.map((line) => (
        <LineItem key={`${line.source}:${line.product_id}`} line={line} />
      ))}
    </div>
  );
}

/** Leads with the product it actually chose and why, then the runners-up it
 * beat. The single-vendor case gets the full hero treatment; a split order
 * lists its lines, since "the final product" is then several of them.
 *
 * `embedded` drops the page-level centering (mx-auto max-w-3xl mt-6) for
 * reuse inside a container that already constrains its own width - the
 * Ledger's row-expand area - without touching Compare.jsx's usage. */
export default function DecisionPanel({
  decision, embedded = false, onCheckout, confirming = false, confirmError = null,
}) {
  const [expanded, setExpanded] = useState(false);
  const { chosen, runner_up, why_rejected, counterfactual, total_cost, latest_delivery } = decision;

  if (!chosen || chosen.mode === "infeasible") return null;

  const isSplit = chosen.mode === "split_order";
  const title = isSplit ? "Split across vendors" : "Best buy";
  const potentialSavings =
    runner_up?.total_cost && total_cost ? runner_up.total_cost - total_cost : 0;
  const winner = chosen.lines?.[0];
  // Confirmation lives inside the decision's own JSON (chosen.confirmed_at),
  // not a separate order record - no fabricated invoice/tracking data, and
  // no schema change needed to persist it.
  const confirmedAt = chosen.confirmed_at ?? null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className={
        "rounded-2xl border border-violet/30 bg-panel p-6 shadow-sm " +
        (embedded ? "" : "mx-auto max-w-3xl mt-6")
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet/15 text-violet text-xs font-bold">
            ★
          </span>
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          {potentialSavings > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Saves {rupees(potentialSavings)}
            </span>
          )}
          <span className="text-xs text-ink/40 font-body">
            {chosen.lines.length} vendor{chosen.lines.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {chosen.why_this_pick && (
        <p className="mt-2 text-sm text-ink/60 font-body">{chosen.why_this_pick}</p>
      )}

      {chosen.bent_rule && (
        <p className="mt-2 text-xs text-amber-700/80 font-body">
          {chosen.bent_rule.replace(/_/g, " ")} relaxed from {chosen.bent_from} to{" "}
          {chosen.bent_to} to make this possible.
        </p>
      )}

      {isSplit || !winner ? (
        <Allocation allocation={chosen} />
      ) : (
        <FinalPick
          line={winner}
          totalCost={total_cost}
          latestDelivery={latest_delivery}
          lineCount={chosen.lines.length}
        />
      )}

      <Comparison alternatives={chosen.alternatives} winnerPrice={winner?.unit_price ?? 0} />

      {/* Feature B: real min/avg price among rigid-rule-qualifying listings
          for this specific run, computed backend-side in price_context() -
          never estimated here. */}
      {chosen.price_context && <PriceContext ctx={chosen.price_context} />}

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between border-t border-edge pt-4 gap-4">
        <div>
          <span className="text-xs text-ink/50 font-body">Total Landed Cost</span>
          <div className="text-xl font-bold text-ink font-display">{rupees(total_cost ?? 0)}</div>
          {latest_delivery != null && (
            <div className="text-xs text-ink/40 font-body">
              arrives within {latest_delivery} days
            </div>
          )}
          {/* Feature A: only for a split_order that actually won on price -
              chosen.savings_vs_single is only ever set by compare_allocations
              when that's true, so no separate ">0" guard is needed here, but
              one is kept anyway as a second line of defence against ever
              rendering a misleading badge. */}
          {isSplit && chosen.savings_vs_single > 0 && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              {rupees(chosen.savings_vs_single)} cheaper than buying all from one vendor
            </div>
          )}
        </div>

        {confirmedAt ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-xs font-semibold text-emerald-800">
            <span>✓ Confirmed (simulated)</span>
            <span className="font-normal text-[11px] text-emerald-700">
              {new Date(confirmedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </span>
          </div>
        ) : onCheckout ? (
          <div className="flex flex-col items-end gap-1.5">
            <motion.button
              type="button"
              onClick={onCheckout}
              disabled={confirming}
              whileHover={confirming ? {} : { scale: 1.02 }}
              whileTap={confirming ? {} : { scale: 0.98 }}
              className="rounded-xl bg-violet px-6 py-3 text-xs font-bold text-white shadow-lg shadow-violet/25 hover:bg-violet-deep transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {confirming ? (
                <motion.span
                  className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                />
              ) : (
                <span>✓ Confirm This Purchase (Simulated)</span>
              )}
            </motion.button>
            {confirmError && (
              <span className="text-[11px] text-rose-600 font-body">{confirmError}</span>
            )}
          </div>
        ) : null}
      </div>

      {runner_up && (
        <div className="mt-4 border-t border-edge/40 pt-3">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-ink/40 hover:text-ink/70 font-body flex items-center gap-1"
          >
            Runner-up: {runner_up.mode === "split_order" ? "split order" : "single vendor"} (
            {rupees(runner_up.total_cost ?? 0)})
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={spring}>
              ▾
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={spring}
                className="overflow-hidden mt-2"
              >
                <Allocation allocation={runner_up} />
                {why_rejected && (
                  <p className="mt-2 text-xs text-ink/40 font-body">{why_rejected}</p>
                )}
                {counterfactual && (
                  <p className="mt-1 text-xs text-ink/30 font-body italic">{counterfactual}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
