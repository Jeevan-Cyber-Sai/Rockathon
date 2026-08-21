import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useAnimation } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { pageVariants, morphSpring, spring, staggerContainer, staggerItem } from "../lib/motion";
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

const FEATURES = [
  {
    accent: "violet",
    label: "Compares live prices",
    detail: "Real listings, fetched at ask time",
    icon: (
      <path d="M3 13h4l3 7 4-16 3 9h4" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    accent: "amber",
    label: "Splits orders automatically",
    detail: "Across vendors when it's cheaper",
    icon: (
      <>
        <path d="M3 12h6.5" strokeLinecap="round" />
        <path d="M9.5 12 16 5.5" strokeLinecap="round" />
        <path d="M9.5 12 16 18.5" strokeLinecap="round" />
        <path d="M12.5 5.5H16V9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.5 18.5H16V15" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    accent: "violet",
    label: "Shows why, not just what",
    detail: "Every rule it bent, on the record",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
      </>
    ),
  },
];

/** Purely decorative: soft blurred colour fields plus a faint grid, so the
 * page reads as a designed surface rather than flat off-white. Sits behind
 * the content, never intercepts a click. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, #C9BDEA 1px, transparent 1px)," +
            "linear-gradient(to bottom, #C9BDEA 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 90% 60% at 50% 35%, black 15%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 60% at 50% 35%, black 15%, transparent 75%)",
        }}
      />
      {/* Tints, not glows: on a light ground these read as washes of colour
          bleeding into the page rather than light sources on top of it. */}
      <div className="absolute -top-48 left-1/2 h-[40rem] w-[40rem] -translate-x-[72%] rounded-full bg-violet/20 blur-[130px]" />
      <div className="absolute -top-32 left-1/2 h-[28rem] w-[28rem] translate-x-[6%] rounded-full bg-amber/[0.16] blur-[120px]" />
      <div className="absolute bottom-[-16rem] left-1/2 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-violet-soft/25 blur-[140px]" />
    </div>
  );
}

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
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24">
      <Backdrop />

      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative z-10 w-full max-w-3xl flex flex-col items-center gap-10 text-center"
      >
        <motion.div
          variants={staggerContainer(0.08)}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-5"
        >
          <motion.img
            variants={staggerItem}
            src="/logo-full.png"
            alt="Shopyx"
            draggable={false}
            className="h-24 sm:h-28 w-auto select-none drop-shadow-[0_10px_28px_rgba(124,58,237,0.22)]"
          />

          <motion.h1
            variants={staggerItem}
            className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-ink
                       leading-[1.1] max-w-2xl"
          >
            Describe what you need.
            <br />
            <span className="bg-shopyx bg-clip-text text-transparent">
              Get the buy, and the reasoning.
            </span>
          </motion.h1>

          <motion.p
            variants={staggerItem}
            className="max-w-xl text-[15px] leading-relaxed text-ink/55 font-body"
          >
            It reads your brief in plain English, compares live listings across vendors,
            splits the order when that lands a better price, and shows exactly which rules
            it had to bend to get there.
          </motion.p>

          <motion.ul
            variants={staggerItem}
            className="mt-1 flex flex-wrap items-stretch justify-center gap-2.5"
          >
            {FEATURES.map((f) => (
              <li
                key={f.label}
                className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/80
                           px-3.5 py-2.5 backdrop-blur-sm text-left
                           shadow-sm shadow-violet/[0.06]"
              >
                <span
                  className={
                    "grid h-7 w-7 shrink-0 place-items-center rounded-lg " +
                    // Deep variants, not the soft ones: a pale icon on a pale
                    // tinted fill all but disappears on a light background.
                    (f.accent === "amber"
                      ? "bg-amber/15 text-amber"
                      : "bg-violet/12 text-violet-deep")
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-4 w-4"
                  >
                    {f.icon}
                  </svg>
                </span>
                <span className="flex flex-col">
                  <span className="text-[12.5px] font-semibold text-ink/85 font-body leading-tight">
                    {f.label}
                  </span>
                  <span className="text-[11px] text-ink/35 font-body leading-tight mt-0.5">
                    {f.detail}
                  </span>
                </span>
              </li>
            ))}
          </motion.ul>
        </motion.div>

        <div className="w-full max-w-2xl">
          <div
            className="rounded-2xl border border-edge bg-panel/85 p-4 sm:p-5
                       shadow-xl shadow-violet/10 backdrop-blur-md"
          >
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40 font-body">
                Start your search
              </span>
            </div>

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
                  "w-full rounded-xl bg-base border px-5 py-4 flex items-center gap-4 " +
                  "transition-shadow duration-150 " +
                  // The input's own outline is suppressed below - a square
                  // ring on a child inside this rounded bar would look like a
                  // bug, not a focus state. focus-within moves the visible
                  // indicator to the bar itself instead of removing it.
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
                  className="flex-1 min-w-0 bg-transparent text-base text-ink placeholder:text-ink/35
                             outline-none font-body"
                />
                {/* Dark ink on the amber fill rather than white: the light
                    end of the gradient is too pale to carry white text. */}
                <motion.button
                  type="submit"
                  disabled={!text.trim() || submitting}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  className="shrink-0 w-24 rounded-lg bg-sunrise py-2 text-sm font-semibold text-ink
                             shadow-md shadow-amber/25
                             disabled:opacity-40 disabled:shadow-none transition-opacity duration-200
                             flex items-center justify-center"
                >
                  {submitting ? (
                    <motion.span
                      className="h-3.5 w-3.5 rounded-full border-2 border-ink/30 border-t-ink"
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                    />
                  ) : (
                    "Find it"
                  )}
                </motion.button>
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
                  className="mt-3 px-1 text-sm text-rose-600 font-body text-left"
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
                  <span className="text-[11px] uppercase tracking-wide text-ink/30 font-body">
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

          <p className="mt-3 text-[11.5px] text-ink/25 font-body">
            Plain English works best — quantity, specs, budget, timeline.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
