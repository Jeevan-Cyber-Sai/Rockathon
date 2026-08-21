import { AnimatePresence, motion } from "framer-motion";
import { spring } from "../lib/motion";
import StatusBadge from "./StatusBadge";
import DecisionPanel from "./DecisionPanel";

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatTimestamp(iso) {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z"); // backend stores naive UTC
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const LIVE_STATUSES = new Set(["running", "awaiting_approval"]);

/** One ledger entry. A live run (still running/awaiting input) routes to
 * /compare on click - there is no finished-run view to show for it yet.
 * A finished run expands in place using the exact same DecisionPanel Phase
 * 3 already built, just re-skinned via `embedded`. */
export default function LedgerRow({ run, expanded, onExpandToggle, onResume, onRerun }) {
  const isLive = LIVE_STATUSES.has(run.status);
  const detail = run._detail;
  const decision = detail?.decisions?.[detail.decisions.length - 1];
  const totalCost = decision?.total_cost;
  // Confirmation lives inside the decision's own JSON (chosen.confirmed_at) -
  // no separate order record, no fabricated invoice/tracking data.
  const confirmedAt = decision?.chosen?.confirmed_at ?? null;

  function handleClick() {
    if (isLive) {
      onResume(run.id);
    } else {
      onExpandToggle(run.id);
    }
  }

  return (
    <motion.div layout className="border-b border-edge/60 last:border-0 py-1">
      <div className="flex items-center gap-2">
        <motion.button
          type="button"
          layout
          onClick={handleClick}
          whileTap={{ scale: 0.995 }}
          transition={spring}
          className="flex-1 min-w-0 flex items-center gap-4 py-3.5 px-3 rounded-lg text-left
                     hover:bg-ink/[0.03] transition-colors duration-150"
        >
          <span className="flex-1 min-w-0 text-sm text-ink/85 font-medium font-body truncate">
            {truncate(run.brief_text, 90)}
          </span>

          {confirmedAt ? (
            <span className="shrink-0 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 flex items-center gap-1">
              <span>✓ Ordered</span>
            </span>
          ) : (
            <span className="w-28 shrink-0"><StatusBadge status={run.status} /></span>
          )}

          <span className="w-28 shrink-0 text-right text-sm text-ink font-semibold font-body">
            {totalCost != null ? `₹${totalCost.toLocaleString("en-IN")}` : "—"}
          </span>
          <span className="w-32 shrink-0 text-right text-xs text-ink/35 font-body tabular-nums">
            {formatTimestamp(run.created_at)}
          </span>
          {isLive ? (
            <span className="w-4 shrink-0 text-right text-violet font-semibold">↗</span>
          ) : (
            <motion.span
              className="w-4 shrink-0 text-right text-ink/30"
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={spring}
            >
              ▾
            </motion.span>
          )}
        </motion.button>

        {onRerun && (
          <button
            type="button"
            title="Re-run this comparison"
            onClick={() => onRerun(run.brief_text)}
            className="shrink-0 p-2 rounded-lg text-ink/40 hover:text-violet hover:bg-violet/10 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && !isLive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="pb-5 px-3">
              <div className="mb-3 flex items-center justify-between gap-2 pt-2 border-t border-edge/40">
                <span className="text-xs font-medium text-ink/40">Run ID: {run.id}</span>
                <div className="flex items-center gap-2">
                  {onRerun && (
                    <button
                      type="button"
                      onClick={() => onRerun(run.brief_text)}
                      className="rounded-lg bg-violet/10 hover:bg-violet/20 text-violet px-3 py-1 text-xs font-semibold transition-colors flex items-center gap-1"
                    >
                      <span>Re-run search</span>
                      <span>&rarr;</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onResume(run.id)}
                    className="rounded-lg border border-edge bg-base px-3 py-1 text-xs font-medium text-ink/70 hover:text-ink hover:border-violet/40 transition-colors"
                  >
                    Open Comparison View
                  </button>
                </div>
              </div>

              {!detail ? (
                <p className="text-xs text-ink/30 font-body py-3">Loading details…</p>
              ) : decision?.chosen?.mode === "infeasible" ? (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
                  <p className="text-sm text-rose-700 font-body">Couldn't find a fit</p>
                  <p className="mt-1 text-xs text-ink/50 font-body">{decision.why_rejected}</p>
                </div>
              ) : decision ? (
                <DecisionPanel decision={decision} embedded onCheckout={() => onResume(run.id)} />
              ) : (
                <p className="text-xs text-ink/40 font-body py-3">No decision recorded for this run.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
