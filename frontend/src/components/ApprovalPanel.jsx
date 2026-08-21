import { useState } from "react";
import { motion } from "framer-motion";
import { spring } from "../lib/motion";
import { approveRun } from "../lib/api";

/** Renders the backend's relaxation options as selectable cards, each
 * labeled with its cost relative to the cheapest option (the closest honest
 * reading of "rupee saving" when there's no feasible strict baseline to
 * compare against - every option here only exists because the strict
 * brief had none). Submitting calls POST /approve; the already-open
 * WebSocket delivers "decided" -> "completed" afterward, no reconnect needed.
 */
export default function ApprovalPanel({ runId, question, options }) {
  const cheapest = Math.min(...options.map((o) => o.total_cost));
  const [selected, setSelected] = useState(options[0]?.key ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleApprove() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await approveRun(runId, selected);
      // Deliberately no local "approved" state flip here - the WS "decided"/
      // "completed" events are what actually move the UI forward, so this
      // panel just waits to be replaced by the parent once those arrive.
    } catch (err) {
      setSubmitting(false);
      setError(err.message);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="mx-auto max-w-3xl mt-6 rounded-2xl border border-amber-500/30 bg-panel p-6"
    >
      <h2 className="font-display text-lg font-semibold text-ink">Needs a decision</h2>
      <p className="mt-1 text-sm text-ink/50 font-body">{question}</p>

      <div className="mt-4 grid gap-2">
        {options.map((opt) => {
          const isCheapest = opt.total_cost === cheapest;
          const delta = opt.total_cost - cheapest;
          return (
            <motion.button
              key={opt.key}
              layout
              type="button"
              onClick={() => setSelected(opt.key)}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              className={
                "text-left rounded-xl border px-4 py-3 font-body transition-colors duration-150 " +
                (selected === opt.key
                  ? "border-violet bg-violet/10"
                  : "border-edge hover:border-ink/20")
              }
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink/90">{opt.description}</span>
                <span className="shrink-0 text-xs font-medium">
                  {isCheapest ? (
                    <span className="text-emerald-600">cheapest</span>
                  ) : (
                    <span className="text-ink/40">+₹{delta.toLocaleString("en-IN")} vs cheapest</span>
                  )}
                </span>
              </div>
              <span className="text-xs text-ink/40">₹{opt.total_cost.toLocaleString("en-IN")} total</span>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={!selected || submitting}
          className="rounded-full bg-shopyx px-5 py-2 text-sm font-semibold text-ink
                     disabled:opacity-40 transition-opacity duration-200"
        >
          {submitting ? "Approving…" : "Approve"}
        </button>
        {error && <span className="text-xs text-rose-600 font-body">{error}</span>}
      </div>
    </motion.div>
  );
}
