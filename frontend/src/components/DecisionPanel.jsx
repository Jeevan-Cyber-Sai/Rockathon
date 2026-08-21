import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { spring } from "../lib/motion";

function LineItem({ line }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-edge last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-ink/90 font-body truncate">{line.title}</p>
        <p className="text-xs text-ink/40 font-body">
          {line.source} · qty {line.qty} · {line.delivery_days != null ? `${line.delivery_days}d delivery` : "delivery unknown"}
        </p>
      </div>
      <span className="shrink-0 text-sm text-ink font-semibold font-body">
        ₹{line.unit_price.toLocaleString("en-IN")}<span className="text-ink/30"> ea</span>
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

/** Shows the chosen allocation prominently; runner-up collapsed behind an
 * expand toggle with why_rejected visible once opened.
 *
 * `embedded` drops the page-level centering (mx-auto max-w-3xl mt-6) for
 * reuse inside a container that already constrains its own width - the
 * Ledger's row-expand area - without touching Compare.jsx's usage. */
export default function DecisionPanel({ decision, embedded = false, onCheckout, order = null }) {
  const [expanded, setExpanded] = useState(false);
  const { chosen, runner_up, why_rejected, counterfactual, total_cost, latest_delivery } = decision;

  if (!chosen || chosen.mode === "infeasible") return null;

  const title = chosen.mode === "split_order" ? "Split across vendors" : "Single vendor";
  const potentialSavings = runner_up?.total_cost && total_cost ? runner_up.total_cost - total_cost : 0;

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet/15 text-violet text-xs font-bold">
            ★
          </span>
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          {potentialSavings > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Saves ₹{potentialSavings.toLocaleString("en-IN")}
            </span>
          )}
          <span className="text-xs text-ink/40 font-body">
            {chosen.lines.length} vendor{chosen.lines.length > 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {chosen.bent_rule && (
        <p className="mt-2 text-xs text-amber-700/80 font-body">
          {chosen.bent_rule.replace(/_/g, " ")} relaxed from {chosen.bent_from} to {chosen.bent_to} to make this possible.
        </p>
      )}

      <Allocation allocation={chosen} />

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between border-t border-edge pt-4 gap-4">
        <div>
          <span className="text-xs text-ink/50 font-body">Total Landed Cost</span>
          <div className="text-xl font-bold text-ink font-display">
            ₹{total_cost?.toLocaleString("en-IN")}
          </div>
          {latest_delivery != null && (
            <div className="text-xs text-ink/40 font-body">arrives within {latest_delivery} days</div>
          )}
        </div>

        {order ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-xs font-semibold text-emerald-800">
            <span>✓ Order Placed</span>
            <span className="font-mono text-[11px] text-emerald-700">({order.invoice_number})</span>
          </div>
        ) : onCheckout ? (
          <motion.button
            type="button"
            onClick={onCheckout}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="rounded-xl bg-violet px-6 py-3 text-xs font-bold text-white shadow-lg shadow-violet/25 hover:bg-violet-deep transition-all flex items-center justify-center gap-2"
          >
            <span>⚡ One-Click Buy with Shopyx</span>
          </motion.button>
        ) : null}
      </div>

      {runner_up && (
        <div className="mt-4 border-t border-edge/40 pt-3">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-ink/40 hover:text-ink/70 font-body flex items-center gap-1"
          >
            Runner-up: {runner_up.mode === "split_order" ? "split order" : "single vendor"}
            (₹{runner_up.total_cost?.toLocaleString("en-IN")})
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={spring}>▾</motion.span>
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

