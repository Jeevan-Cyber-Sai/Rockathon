import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { spring } from "../lib/motion";

const rupees = (n) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;

/**
 * Simulated purchase confirmation - NOT a checkout flow. Shopyx analyzes
 * and recommends; it never processes a real transaction, so there is
 * nothing to collect here (no name, no address, no payment method) and
 * nothing invented (no fake invoice/tracking numbers, no fabricated
 * shipment timeline).
 *
 * By the time this opens, Compare.jsx has already re-confirmed the
 * decision against the backend with a plain GET /runs/:id - the same
 * endpoint every other screen already uses to read a run, not a new one -
 * so what's shown here is the real, currently-persisted allocation, not a
 * client-side guess. This component only ever renders that result.
 */
export default function ConfirmationModal({ isOpen, onClose, decision }) {
  const navigate = useNavigate();
  if (!isOpen || !decision) return null;

  const chosen = decision.chosen ?? {};
  const lines = chosen.lines ?? [];
  const vendors = Array.from(new Set(lines.map((l) => l.source)));
  const totalQty = lines.reduce((acc, l) => acc + (l.qty || 1), 0);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-ink/60 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={spring}
          className="relative w-full max-w-md rounded-3xl border border-edge bg-panel p-6 sm:p-8 shadow-2xl shadow-violet/20 z-10 my-8"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-2 text-ink/40 hover:bg-ink/5 hover:text-ink transition-colors"
          >
            ✕
          </button>

          <div className="text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 mb-4">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <h3 className="font-display text-xl font-bold text-ink">Purchase confirmed (simulated)</h3>
            <p className="mt-1.5 text-xs text-ink/45 font-body max-w-xs mx-auto">
              This is a decision simulation — no real payment was processed.
            </p>

            <div className="mt-6 rounded-2xl border border-edge bg-base/60 p-4 text-left">
              <div className="flex items-center justify-between text-xs font-semibold text-ink/50 font-body mb-2.5">
                <span>Confirmed allocation</span>
                <span>{vendors.join(" + ")}</span>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 text-xs border-b border-edge/40 pb-2 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0 truncate">
                      <span className="font-medium text-ink/85">{line.title}</span>
                      <span className="text-ink/40"> · qty {line.qty}</span>
                    </div>
                    <span className="shrink-0 font-semibold text-ink">
                      {rupees((line.unit_price || 0) * (line.qty || 1))}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-edge pt-3">
                <span className="text-xs text-ink/50 font-body">
                  {totalQty} unit{totalQty === 1 ? "" : "s"} total
                </span>
                <span className="text-base font-bold text-ink font-display">{rupees(decision.total_cost)}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate("/ledger");
                }}
                className="w-full sm:w-auto rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet/25 hover:bg-violet-deep transition-all"
              >
                View in History &rarr;
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto rounded-xl border border-edge bg-panel px-6 py-3 text-sm font-medium text-ink/75 hover:text-ink transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
