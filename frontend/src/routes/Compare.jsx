import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useLocation, useParams } from "react-router-dom";
import { morphSpring, spring } from "../lib/motion";
import { rulesToChips } from "../lib/formatRule";
import { getRun } from "../lib/api";
import { useRunStream } from "../lib/useRunStream";
import Chip from "../components/Chip";
import StepTracker from "../components/StepTracker";
import ProductCard from "../components/ProductCard";
import DecisionPanel from "../components/DecisionPanel";
import ApprovalPanel from "../components/ApprovalPanel";
import ConnectionBanner from "../components/ConnectionBanner";

const REVEAL_STAGGER_MS = 80; // within the requested 60-100ms window
const key = (l) => `${l.source}:${l.product_id}`;

export default function Compare() {
  const { runId } = useParams();
  const location = useLocation();

  const [briefText, setBriefText] = useState(location.state?.briefText ?? null);
  const [parsedRules, setParsedRules] = useState(null);
  const [flipped, setFlipped] = useState(() => new Set());
  const [doneStages, setDoneStages] = useState(() => new Set());

  const [listingsByKey, setListingsByKey] = useState({});
  const [revealedKeys, setRevealedKeys] = useState([]);
  const [rejectedByKey, setRejectedByKey] = useState({});
  const [scoreOrder, setScoreOrder] = useState([]);

  const [decision, setDecision] = useState(null);
  const [approval, setApproval] = useState(null);
  const [failReason, setFailReason] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const revealTimers = useRef([]);

  // Resuming a run (e.g. from the Ledger) opens a brand-new WebSocket
  // connection, and the backend doesn't replay stage events that already
  // fired before this connection existed - only what's live from here on.
  // Everything that already happened has to come from what's actually
  // persisted, fetched once on mount. This runs for a freshly-submitted
  // run too (harmless no-op there: nothing's saved yet, the WS carries it).
  useEffect(() => {
    let cancelled = false;
    getRun(runId).then((run) => {
      if (cancelled) return;
      if (!location.state?.briefText) setBriefText(run.brief_text);
      if (run.parsed_rules) {
        setParsedRules(run.parsed_rules);
        setDoneStages((prev) => new Set(prev).add("parsed"));
      }
      const snapshot = run.listings?.[run.listings.length - 1]?.listings;
      if (snapshot?.length) {
        setListingsByKey(Object.fromEntries(snapshot.map((l) => [key(l), l])));
        setRevealedKeys(snapshot.map(key)); // catching up, not arriving live - no stagger
        setDoneStages((prev) => new Set(prev).add("fetched"));
      }
      if (run.decisions?.length) {
        setDecision(run.decisions[run.decisions.length - 1]);
        // A decision can't exist without filtering/scoring/deciding having
        // run - the per-card reasons/order are gone (never persisted), but
        // the stages themselves genuinely completed.
        setDoneStages((prev) => new Set([...prev, "filtered", "scored", "decided"]));
      }
      const pending = run.approvals?.find((a) => a.chosen_option === null);
      if (pending && run.status === "awaiting_approval") {
        setApproval({ question: pending.question, options: pending.options });
        setDoneStages((prev) => new Set([...prev, "filtered", "scored", "awaiting_approval"]));
      }
      if (run.status === "failed" && run.decisions?.length) {
        const last = run.decisions[run.decisions.length - 1];
        if (last.chosen?.mode === "infeasible") setFailReason(last.why_rejected);
      }
    }).catch((err) => {
      if (cancelled) return;
      // A bad/typo'd run_id (or one that never existed) 404s here - that's
      // the one hydration failure that means there's genuinely nothing to
      // show, not just "hasn't happened yet".
      if (err.message.startsWith("404")) setNotFound(true);
    });
    return () => { cancelled = true; };
  }, [runId]);
  useEffect(() => () => revealTimers.current.forEach(clearTimeout), []);

  const connectionStatus = useRunStream(runId, (msg) => {
    const { stage, data } = msg;
    if (stage === "current_state") return;
    setDoneStages((prev) => new Set(prev).add(stage));

    switch (stage) {
      case "parsed":
        setParsedRules(data.rules);
        break;

      case "fetched": {
        const byKey = Object.fromEntries(data.listings.map((l) => [key(l), l]));
        setListingsByKey(byKey);
        // Data arrives all at once; the reveal is deliberately faked client-
        // side so cards feel like they're arriving live, not dumped in.
        data.listings.forEach((l, i) => {
          const id = setTimeout(() => {
            setRevealedKeys((prev) => (prev.includes(key(l)) ? prev : [...prev, key(l)]));
          }, i * REVEAL_STAGGER_MS);
          revealTimers.current.push(id);
        });
        break;
      }

      case "filtered": {
        const map = {};
        for (const r of data.rejected) map[`${r.source}:${r.product_id}`] = r.reason;
        setRejectedByKey(map);
        break;
      }

      case "scored":
        setScoreOrder(data.order.map((o) => `${o.source}:${o.product_id}`));
        break;

      case "awaiting_approval":
        setApproval({ question: data.question ?? "No allocation meets every rule as stated.", options: data.options });
        break;

      case "decided":
        setApproval(null); // covers both the first solve and a post-approval resume
        getRun(runId).then((run) => {
          if (run.decisions?.length) setDecision(run.decisions[run.decisions.length - 1]);
        });
        break;

      case "failed":
        setFailReason(data.reason);
        break;

      default:
        break;
    }
  });

  // Two independent signals can both mean "this run doesn't exist" - the
  // REST hydration 404ing, or the WebSocket's own "error" stage (sent when
  // store.get_run() comes back None on connect). Either one is enough.
  useEffect(() => {
    if (connectionStatus === "not_found") setNotFound(true);
  }, [connectionStatus]);

  function toggleFlip(k) {
    setFlipped((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }

  const chips = parsedRules ? rulesToChips(parsedRules) : [];

  // Survivors in score-rank order, then whatever's revealed-but-not-yet-
  // classified (pre-filter/score) or rejected, in arrival order. Recomputes
  // every render, so cards still trickling in via the reveal timers slot
  // into their correct position the moment they appear.
  const orderedKeys = useMemo(() => {
    const revealedSet = new Set(revealedKeys);
    if (scoreOrder.length === 0) return revealedKeys;
    const survivors = scoreOrder.filter((k) => revealedSet.has(k));
    const rest = revealedKeys.filter((k) => !scoreOrder.includes(k));
    return [...survivors, ...rest];
  }, [revealedKeys, scoreOrder]);

  // This early return has to come after every hook above it - React
  // requires the same hooks in the same order on every render, and a
  // conditional return placed before a hook (as this originally was, before
  // a hooks-order bug here) skips that hook on whichever render takes this
  // branch, which React detects and throws on.
  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">Run not found</h1>
        <p className="text-sm text-ink/40 font-body max-w-sm">
          There's no run at this address - the link may be old or mistyped.
        </p>
        <Link
          to="/search"
          className="mt-2 rounded-full bg-shopyx px-5 py-2 text-sm font-semibold text-cream
                     transition-opacity duration-200 hover:opacity-90"
        >
          Start a new search
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 px-6 pb-24">
      <motion.div
        layoutId="brief-bar"
        transition={{ layout: morphSpring }}
        className="mx-auto max-w-3xl rounded-xl bg-panel border border-edge px-5 py-3
                   flex items-center gap-3 shadow-lg shadow-violet/[0.07]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet" />
        <span className="flex-1 truncate text-sm text-ink/80 font-body">{briefText ?? "…"}</span>
        <span className="shrink-0 text-xs text-ink/30 font-body">run {runId}</span>
      </motion.div>

      <div className="mx-auto max-w-3xl mt-4 min-h-[32px] flex flex-wrap items-center gap-2">
        <AnimatePresence mode="popLayout">
          {chips.length > 0
            ? chips.map((c) => (
                <Chip
                  key={c.key}
                  mode="confirmed"
                  label={c.label}
                  elastic={c.elastic}
                  flipped={flipped.has(c.key)}
                  onToggle={() => toggleFlip(c.key)}
                />
              ))
            : !doneStages.has("parsed") && (
                <motion.span
                  key="reading"
                  variants={{
                    initial: { opacity: 0 },
                    animate: {
                      opacity: [0.3, 0.7, 0.3],
                      transition: { repeat: Infinity, duration: 1.4, ease: "easeInOut" },
                    },
                    exit: { opacity: 0, transition: { duration: 0.15 } },
                  }}
                  initial="initial" animate="animate" exit="exit"
                  className="text-[11px] uppercase tracking-wide text-ink/30 font-body"
                >
                  reading the brief…
                </motion.span>
              )}
        </AnimatePresence>
      </div>

      <div className="mx-auto max-w-3xl mt-5 flex items-center justify-between gap-4">
        <StepTracker doneStages={doneStages} />
        <ConnectionBanner status={connectionStatus} />
      </div>

      {failReason && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}
          className="mx-auto max-w-3xl mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6"
        >
          <h2 className="font-display text-lg font-semibold text-rose-700">Couldn't find a fit</h2>
          <p className="mt-1 text-sm text-ink/50 font-body">{failReason}</p>
        </motion.div>
      )}

      {approval && !decision && (
        <ApprovalPanel runId={runId} question={approval.question} options={approval.options} />
      )}

      {decision && <DecisionPanel decision={decision} />}

      <motion.div layout className="mx-auto max-w-3xl mt-8 grid gap-3">
        <AnimatePresence>
          {orderedKeys.map((k) => (
            <ProductCard key={k} listing={listingsByKey[k]} reason={rejectedByKey[k]} />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
