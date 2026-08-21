import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { pageVariants, spring, staggerContainer, staggerItem } from "../lib/motion";
import { getRun, listRuns } from "../lib/api";
import LedgerRow from "../components/LedgerRow";

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-4 border-b border-edge/60 last:border-0">
      <motion.div
        animate={{ opacity: [0.35, 0.6, 0.35] }}
        transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut" }}
        className="h-4 flex-1 rounded bg-ink/5"
      />
      <motion.div
        animate={{ opacity: [0.35, 0.6, 0.35] }}
        transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut", delay: 0.1 }}
        className="h-4 w-20 rounded bg-ink/5"
      />
      <motion.div
        animate={{ opacity: [0.35, 0.6, 0.35] }}
        transition={{ repeat: Infinity, duration: 1.3, ease: "easeInOut", delay: 0.2 }}
        className="h-4 w-16 rounded bg-ink/5"
      />
    </div>
  );
}

export default function Ledger() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setRuns(null);
    listRuns().then((rows) => {
      setRuns(rows);
      // Backfill total_cost/decision detail for finished runs only - a
      // still-running row routes away instead of expanding, so its detail
      // is never needed here.
      rows
        .filter((r) => r.status === "completed" || r.status === "failed")
        .forEach((r) => {
          getRun(r.id).then((full) => {
            setRuns((prev) => prev && prev.map((x) => (x.id === r.id ? { ...x, _detail: full } : x)));
          }).catch(() => {});
        });
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleExpandToggle(id) {
    setExpandedId((prev) => (prev === id ? null : id));
    const run = runs?.find((r) => r.id === id);
    if (run && !run._detail) {
      getRun(id).then((full) => {
        setRuns((prev) => prev.map((x) => (x.id === id ? { ...x, _detail: full } : x)));
      }).catch(() => {});
    }
  }

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen pt-28 px-6 pb-16"
    >
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-semibold text-ink">Ledger</h1>
        <p className="mt-2 text-sm text-ink/40 font-body">
          Every decision this agent has made, in one place.
        </p>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}
            className="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 flex items-center justify-between gap-4"
          >
            <p className="text-sm text-rose-700 font-body">Couldn't load runs: {error}</p>
            <button
              onClick={load}
              className="shrink-0 rounded-full border border-rose-500/40 px-4 py-1.5 text-xs font-semibold
                         text-rose-700 hover:bg-rose-500/10 transition-colors duration-150"
            >
              Retry
            </button>
          </motion.div>
        )}

        {runs === null && !error && (
          <div className="mt-8 rounded-2xl border border-edge bg-panel px-4">
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
          </div>
        )}

        {runs?.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}
            className="mt-10 rounded-2xl border border-edge bg-panel p-8 text-center"
          >
            <p className="text-sm text-ink/50 font-body">Nothing here yet.</p>
            <button
              onClick={() => navigate("/")}
              className="mt-4 rounded-full bg-shopyx px-5 py-2 text-sm font-semibold text-ink
                         transition-opacity duration-200 hover:opacity-90"
            >
              Describe what you're buying
            </button>
          </motion.div>
        )}

        {runs && runs.length > 0 && (
          <motion.div
            variants={staggerContainer(0.05)}
            initial="initial"
            animate="animate"
            className="mt-8 rounded-2xl border border-edge bg-panel px-4"
          >
            {runs.map((run) => (
              <motion.div key={run.id} variants={staggerItem} layout>
                <LedgerRow
                  run={run}
                  expanded={expandedId === run.id}
                  onExpandToggle={handleExpandToggle}
                  onResume={(id) => navigate(`/compare/${id}`)}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
