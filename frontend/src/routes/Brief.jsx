import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useAnimation } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { pageVariants, morphSpring, spring } from "../lib/motion";
import { previewParse } from "../lib/previewParse";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { postBrief } from "../lib/api";
import Chip from "../components/Chip";

const EXAMPLES = [
  "10 laptops, 16GB RAM, under ₹45,000, within 7 days",
  "5 office chairs, budget flexible, need them by Friday",
  "25 monitors, no more than ₹12,000 each, delivery within 5 days",
];

const PREVIEW_ORDER = ["quantity", "ram", "storage", "price", "delivery"];

// A genuine spring shake: each leg is its own point-to-point spring (real
// overshoot-and-settle physics), chained with decaying amplitude - not a
// single linear back-and-forth tween.
const SHAKE_SPRING = { type: "spring", stiffness: 700, damping: 14, mass: 0.5 };
const SHAKE_STEPS = [-10, 8, -6, 4, -2, 0];

export default function Brief() {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const navigate = useNavigate();
  const barControls = useAnimation();

  const debouncedText = useDebouncedValue(text, 500);
  const previewChips = useMemo(() => previewParse(debouncedText), [debouncedText]);
  const showPreview = debouncedText.trim().length > 0 && Object.keys(previewChips).length > 0;

  // Rotate the empty-state placeholder through real example briefs so the
  // blank input teaches by example rather than sitting empty.
  useEffect(() => {
    if (text) return; // only cycle while genuinely empty
    const id = setInterval(() => setPlaceholderIndex((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(id);
  }, [text]);

  async function shakeBar() {
    for (const x of SHAKE_STEPS) {
      await barControls.start({ x }, SHAKE_SPRING);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const { run_id } = await postBrief(trimmed);
      // Navigate on success only - the bar's layoutId morph is what carries
      // it into the Compare header. Nothing to reset: this component unmounts.
      navigate(`/compare/${run_id}`, { state: { briefText: trimmed } });
    } catch (err) {
      setSubmitting(false);
      setError(err.message);
      shakeBar();
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="w-full max-w-2xl flex flex-col items-center gap-8 text-center"
      >
        <div>
          <h1 className="font-display text-3xl font-semibold text-white">
            What are you buying?
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Describe it in plain English. Quantity, specs, budget, timeline.
          </p>
        </div>

        <div className="w-full">
          {/* Shake and layoutId are deliberately on two different elements.
              Framer Motion's layout-projection system (from layoutId) and an
              imperative x-offset animation (from animate={barControls})
              fight over the same node's transform if combined directly - the
              projected layout transform wins and the shake never visibly
              moves. The outer div owns the shake; the inner form owns only
              the cross-route morph, untouched by it. */}
          <motion.div animate={barControls}>
            <motion.form
              layoutId="brief-bar"
              transition={{ layout: morphSpring }}
              onSubmit={handleSubmit}
              className={
                "w-full rounded-2xl bg-panel border px-6 py-5 flex items-center gap-4 " +
                "shadow-xl shadow-black/20 transition-shadow duration-150 " +
                // The input's own outline is suppressed below - a square
                // ring on a child inside this rounded pill would look like a
                // bug, not a focus state. focus-within moves the visible
                // indicator to the pill itself instead of removing it.
                "focus-within:ring-2 focus-within:ring-violet/50 " +
                (error ? "border-rose-500/50" : "border-edge")
              }
            >
              <input
                autoFocus
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={EXAMPLES[placeholderIndex]}
                className="flex-1 bg-transparent text-base text-white placeholder:text-white/30
                           outline-none font-body"
              />
              <button
                type="submit"
                disabled={!text.trim() || submitting}
                className="shrink-0 w-24 rounded-full bg-shopyx py-2 text-sm font-semibold text-white
                           disabled:opacity-40 transition-opacity duration-200
                           flex items-center justify-center"
              >
                {submitting ? (
                  <motion.span
                    className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white"
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                  />
                ) : (
                  "Find it"
                )}
              </button>
            </motion.form>
          </motion.div>

          <AnimatePresence mode="wait">
            {error ? (
              <motion.p
                key="error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={spring}
                className="mt-3 text-sm text-rose-400 font-body"
              >
                Couldn't submit that: {error}
              </motion.p>
            ) : showPreview ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={spring}
                className="mt-3 flex flex-col items-center gap-2"
              >
                <span className="text-[11px] uppercase tracking-wide text-white/30 font-body">
                  detecting…
                </span>
                <div className="flex flex-wrap justify-center gap-2">
                  {PREVIEW_ORDER.filter((k) => previewChips[k]).map((k) => (
                    <Chip key={k} mode="preview" label={previewChips[k]} />
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
