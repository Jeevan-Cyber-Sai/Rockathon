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
export default function LedgerRow({ run, expanded, onExpandToggle, onResume }) {
  const isLive = LIVE_STATUSES.has(run.status);
  const detail = run._detail;
  const decision = detail?.decisions?.[detail.decisions.length - 1];
  const totalCost = decision?.total_cost;

  function handleClick() {
    if (isLive) {
      onResume(run.id);
    } else {
      onExpandToggle(run.id);
    }
  }

  return (
    <motion.div layout className="border-b border-edge/60 last:border-0">
      <motion.button
        type="button"
        layout
        onClick={handleClick}
        whileTap={{ scale: 0.995 }}
        transition={spring}
        className="w-full flex items-center gap-4 py-4 px-2 -mx-2 rounded-lg text-left
                   hover:bg-ink/[0.03] transition-colors duration-150"
      >
        <span className="flex-1 min-w-0 text-sm text-ink/80 font-body truncate">
          {truncate(run.brief_text, 90)}
        </span>
        <span className="w-28 shrink-0"><StatusBadge status={run.status} /></span>
        <span className="w-28 shrink-0 text-right text-sm text-ink font-semibold font-body">
          {totalCost != null ? `₹${totalCost.toLocaleString("en-IN")}` : "—"}
        </span>
        <span className="w-32 shrink-0 text-right text-xs text-ink/30 font-body tabular-nums">
          {formatTimestamp(run.created_at)}
        </span>
        {isLive ? (
          <span className="w-4 shrink-0 text-right text-ink/20">↗</span>
        ) : (
          <motion.span
            className="w-4 shrink-0 text-right text-ink/20"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={spring}
          >
            ▾
          </motion.span>
        )}
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && !isLive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="pb-5">
              {!detail ? (
                <p className="text-xs text-ink/30 font-body py-3">Loading details…</p>
              ) : decision?.chosen?.mode === "infeasible" ? (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
                  <p className="text-sm text-rose-700 font-body">Couldn't find a fit</p>
                  <p className="mt-1 text-xs text-ink/50 font-body">{decision.why_rejected}</p>
                </div>
              ) : decision ? (
                <DecisionPanel decision={decision} embedded />
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
