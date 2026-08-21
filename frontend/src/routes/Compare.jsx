import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation, useParams } from "react-router-dom";
import { morphSpring, staggerContainer, staggerItem, spring } from "../lib/motion";
import { rulesToChips } from "../lib/formatRule";
import { getRun } from "../lib/api";
import Chip from "../components/Chip";

const POLL_MS = 400;
const POLL_MAX_ATTEMPTS = 30; // ~12s ceiling - well past anything seen from the backend

export default function Compare() {
  const { runId } = useParams();
  const location = useLocation();
  const briefText = location.state?.briefText ?? "(brief not available - direct link, no backend yet)";

  const [parsedRules, setParsedRules] = useState(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [flipped, setFlipped] = useState(() => new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let attempts = 0;

    async function poll() {
      if (!mounted.current) return;
      attempts += 1;
      try {
        const run = await getRun(runId);
        if (!mounted.current) return;
        if (run.parsed_rules) {
          setParsedRules(run.parsed_rules);
          return; // done - stop polling once the real rules exist
        }
      } catch {
        // a transient failure here just means "keep waiting" - the run
        // itself was already accepted (we navigated here on a 2xx POST).
      }
      if (attempts >= POLL_MAX_ATTEMPTS) {
        setPollFailed(true);
        return;
      }
      setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      mounted.current = false;
    };
  }, [runId]);

  function toggleFlip(key) {
    setFlipped((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const chips = parsedRules ? rulesToChips(parsedRules) : [];

  return (
    <div className="min-h-screen pt-24 px-6 pb-16">
      <motion.div
        layoutId="brief-bar"
        transition={{ layout: morphSpring }}
        className="mx-auto max-w-3xl rounded-xl bg-panel border border-edge px-5 py-3
                   flex items-center gap-3 shadow-lg shadow-black/20"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet" />
        <span className="flex-1 truncate text-sm text-white/80 font-body">{briefText}</span>
        <span className="shrink-0 text-xs text-white/30 font-body">run {runId}</span>
      </motion.div>

      {/* Confirmed chips: replaces Brief's provisional preview once the real
          parse lands. Red = rigid, amber = elastic, tap flips (visual only
          for now - wiring the flip to the backend is a later phase). */}
      <div className="mx-auto max-w-3xl mt-4 min-h-[32px] flex flex-wrap gap-2">
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
            : !pollFailed && (
                <motion.span
                  key="parsing"
                  variants={{
                    initial: { opacity: 0 },
                    // The infinite pulse must live ONLY on "animate" - if it
                    // shares a transition with "exit", exit never finishes
                    // (a repeating animation has no completion), so the
                    // element lingers half-visible and eats clicks on
                    // whatever renders underneath it.
                    animate: {
                      opacity: [0.3, 0.7, 0.3],
                      transition: { repeat: Infinity, duration: 1.4, ease: "easeInOut" },
                    },
                    exit: { opacity: 0, transition: { duration: 0.15 } },
                  }}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="text-[11px] uppercase tracking-wide text-white/30 font-body"
                >
                  parsing…
                </motion.span>
              )}
          {pollFailed && chips.length === 0 && (
            <motion.span
              key="poll-failed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={spring}
              className="text-xs text-white/30 font-body"
            >
              Still working on it - taking longer than usual.
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Placeholder content, staggered in after the bar has had time to
          settle into place - deliberately starts after the morph, not
          alongside it. Unchanged from Phase 1: real cards are Phase 3. */}
      <motion.div
        variants={staggerContainer(0.32)}
        initial="initial"
        animate="animate"
        className="mx-auto max-w-3xl mt-10 grid gap-4"
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            variants={staggerItem}
            className="rounded-2xl bg-panel border border-edge p-6 h-28
                       flex items-center text-white/25 font-body text-sm"
          >
            Product comparison card placeholder — real data in Phase 3
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
