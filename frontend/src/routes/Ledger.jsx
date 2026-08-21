import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
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
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(() => {
    setError(null);
    setRuns(null);
    listRuns(100)
      .then((rows) => {
        setRuns(rows);
        // Backfill total_cost/decision detail for finished runs only
        rows
          .filter((r) => r.status === "completed" || r.status === "failed")
          .forEach((r) => {
            getRun(r.id)
              .then((full) => {
                setRuns((prev) =>
                  prev && prev.map((x) => (x.id === r.id ? { ...x, _detail: full } : x)),
                );
              })
              .catch(() => {});
          });
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleExpandToggle(id) {
    setExpandedId((prev) => (prev === id ? null : id));
    const run = runs?.find((r) => r.id === id);
    if (run && !run._detail) {
      getRun(id)
        .then((full) => {
          setRuns((prev) => prev.map((x) => (x.id === id ? { ...x, _detail: full } : x)));
        })
        .catch(() => {});
    }
  }

  function handleRerun(briefText) {
    navigate("/search", { state: { initialText: briefText } });
  }

  // Filtered runs based on search input and status tabs
  const filteredRuns = useMemo(() => {
    if (!runs) return null;
    return runs.filter((r) => {
      const matchText =
        !searchFilter.trim() ||
        (r.brief_text && r.brief_text.toLowerCase().includes(searchFilter.toLowerCase())) ||
        r.id.toLowerCase().includes(searchFilter.toLowerCase());

      const hasOrder = Boolean(r._detail?.orders?.length || r.orders?.length);

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "ordered" && hasOrder) ||
        (statusFilter === "completed" && r.status === "completed") ||
        (statusFilter === "live" && (r.status === "running" || r.status === "awaiting_approval")) ||
        (statusFilter === "failed" && r.status === "failed");

      return matchText && matchStatus;
    });
  }, [runs, searchFilter, statusFilter]);

  const stats = useMemo(() => {
    if (!runs) return { total: 0, completed: 0, live: 0, ordered: 0 };
    return {
      total: runs.length,
      completed: runs.filter((r) => r.status === "completed").length,
      live: runs.filter((r) => r.status === "running" || r.status === "awaiting_approval").length,
      ordered: runs.filter((r) => r._detail?.orders?.length || r.orders?.length).length,
    };
  }, [runs]);

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen pt-24 px-6 pb-20"
    >
      <div className="mx-auto max-w-3xl">
        {/* Header with Stats & New Search Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink">
                Search History & Ledger
              </h1>
              {runs && (
                <span className="rounded-full bg-violet/10 px-2.5 py-0.5 text-xs font-semibold text-violet">
                  {runs.length} runs
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink/50 font-body">
              Every comparison, trade-off, and allocation recorded in real time.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={load}
              title="Refresh ledger"
              className="rounded-xl border border-edge bg-panel px-3 py-2 text-xs font-medium text-ink/70 hover:text-ink hover:border-violet/40 transition-all flex items-center gap-1.5"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>Refresh</span>
            </button>
            <Link
              to="/search"
              className="rounded-xl bg-violet px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet/20 hover:bg-violet-deep transition-all flex items-center gap-1.5"
            >
              <span>+ New Search</span>
            </Link>
          </div>
        </div>

        {/* Stats bar */}
        {runs && runs.length > 0 && (
          <div className="mt-6 grid grid-cols-3 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-edge bg-panel/70 p-3 text-center">
              <span className="text-[11px] text-ink/40 font-body">Comparisons</span>
              <p className="mt-0.5 font-display text-lg font-semibold text-ink">{stats.total}</p>
            </div>
            <div className="rounded-xl border border-edge bg-panel/70 p-3 text-center">
              <span className="text-[11px] text-emerald-600/75 font-body">Completed</span>
              <p className="mt-0.5 font-display text-lg font-semibold text-emerald-700">
                {stats.completed}
              </p>
            </div>
            <div className="rounded-xl border border-edge bg-panel/70 p-3 text-center">
              <span className="text-[11px] text-violet font-semibold font-body">✓ Ordered</span>
              <p className="mt-0.5 font-display text-lg font-semibold text-violet">{stats.ordered}</p>
            </div>
            <div className="rounded-xl border border-edge bg-panel/70 p-3 text-center col-span-3 sm:col-span-1">
              <span className="text-[11px] text-amber-600/75 font-body">Live / Active</span>
              <p className="mt-0.5 font-display text-lg font-semibold text-amber-700">{stats.live}</p>
            </div>
          </div>
        )}

        {/* Real-time Search & Filter Controls */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/35"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search history by keyword, budget, run ID..."
              className="w-full rounded-xl border border-edge bg-panel pl-9 pr-8 py-2 text-xs sm:text-sm text-ink placeholder:text-ink/35 outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 transition-all font-body"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink/40 hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-panel p-1 rounded-xl border border-edge">
            {[
              { id: "all", label: "All" },
              { id: "ordered", label: "Ordered" },
              { id: "completed", label: "Completed" },
              { id: "live", label: "Live" },
              { id: "failed", label: "Failed" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                  statusFilter === tab.id
                    ? "bg-violet text-white font-semibold shadow-sm"
                    : "text-ink/60 hover:text-ink hover:bg-ink/[0.04]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error notification */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 flex items-center justify-between gap-4"
          >
            <p className="text-sm text-rose-700 font-body">Couldn't load history: {error}</p>
            <button
              onClick={load}
              className="shrink-0 rounded-full border border-rose-500/40 px-4 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-500/10 transition-colors"
            >
              Retry
            </button>
          </motion.div>
        )}

        {/* Skeleton loading state */}
        {runs === null && !error && (
          <div className="mt-6 rounded-2xl border border-edge bg-panel px-4 py-2">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        )}

        {/* Empty history */}
        {runs && runs.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="mt-8 rounded-2xl border border-edge bg-panel p-10 text-center"
          >
            <div className="mx-auto w-12 h-12 rounded-full bg-violet/10 flex items-center justify-center text-violet mb-3">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l4 2" />
              </svg>
            </div>
            <h3 className="font-display text-base font-semibold text-ink">No searches recorded yet</h3>
            <p className="mt-1 text-sm text-ink/50 font-body max-w-sm mx-auto">
              Whenever you search for products across marketplaces, they will be saved here automatically.
            </p>
            <Link
              to="/search"
              className="mt-5 inline-block rounded-full bg-violet px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet/25 transition-all hover:bg-violet-deep"
            >
              Start your first search
            </Link>
          </motion.div>
        )}

        {/* No filter match */}
        {runs && runs.length > 0 && filteredRuns && filteredRuns.length === 0 && (
          <div className="mt-8 rounded-2xl border border-edge bg-panel p-8 text-center">
            <p className="text-sm text-ink/60 font-body">
              No comparisons match your filter <span className="font-semibold">"{searchFilter}"</span>.
            </p>
            <button
              onClick={() => {
                setSearchFilter("");
                setStatusFilter("all");
              }}
              className="mt-3 text-xs font-semibold text-violet hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* History List */}
        {filteredRuns && filteredRuns.length > 0 && (
          <motion.div
            variants={staggerContainer(0.04)}
            initial="initial"
            animate="animate"
            className="mt-6 rounded-2xl border border-edge bg-panel px-4 shadow-sm"
          >
            <AnimatePresence mode="popLayout">
              {filteredRuns.map((run) => (
                <motion.div key={run.id} variants={staggerItem} layout>
                  <LedgerRow
                    run={run}
                    expanded={expandedId === run.id}
                    onExpandToggle={handleExpandToggle}
                    onResume={(id) => navigate(`/compare/${id}`)}
                    onRerun={handleRerun}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
