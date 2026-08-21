import { forwardRef } from "react";
import { motion } from "framer-motion";
import { spring } from "../lib/motion";

/**
 * Two distinct visual languages, deliberately not just a color swap:
 * - preview: dashed border, dim, no interaction - "this is a guess"
 * - confirmed: solid fill, red (rigid) or amber (elastic), tappable - "this
 *   is what the backend actually decided"
 * The tap only flips local visual state for now - it doesn't touch the
 * backend yet (that's a later phase, per spec).
 *
 * forwardRef is required here, not decorative: AnimatePresence
 * mode="popLayout" (used for the chip row) attaches a ref to its direct
 * children to measure them during exit. A plain function component can't
 * receive that ref - React logs a warning and popLayout silently can't
 * track the element.
 */
const Chip = forwardRef(function Chip({ label, mode = "preview", elastic, flipped, onToggle }, ref) {
  if (mode === "preview") {
    return (
      <motion.span
        ref={ref}
        layout
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={spring}
        className="inline-flex items-center rounded-full border border-dashed border-ink/20
                   px-3 py-1 text-xs text-ink/50 font-body"
      >
        {label}
      </motion.span>
    );
  }

  const isElastic = flipped ? !elastic : elastic;

  return (
    <motion.button
      ref={ref}
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      whileTap={{ scale: 0.92 }}
      transition={spring}
      onClick={onToggle}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium font-body " +
        "border transition-colors duration-150 " +
        (isElastic
          ? "bg-amber-500/15 border-amber-500/40 text-amber-700"
          : "bg-rose-500/15 border-rose-500/40 text-rose-700")
      }
      title={isElastic ? "Elastic - can bend. Tap to flip." : "Rigid - won't bend. Tap to flip."}
    >
      <span className={"h-1.5 w-1.5 rounded-full " + (isElastic ? "bg-amber-400" : "bg-rose-400")} />
      {label}
    </motion.button>
  );
});

export default Chip;
