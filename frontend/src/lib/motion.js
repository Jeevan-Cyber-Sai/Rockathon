/**
 * The one spring every animated thing in this app uses - page transitions,
 * the layoutId morph, staggered reveals. "No default ease" means literally
 * that: nothing here reaches for a duration+curve tween. If a component
 * needs motion, it imports `spring` from here rather than inventing its own.
 */
export const spring = { type: "spring", stiffness: 300, damping: 30, mass: 0.8 };

// A touch stiffer/less floaty - reserved for the shared-element morph itself
// (the input -> header bar), which reads as "solid" rather than "springy"
// specifically because it's supposed to feel like one continuous object,
// not a bouncy entrance. Same spring family, same "no tween" rule - only the
// physics constants change, tuned for that specific motion.
export const morphSpring = { type: "spring", stiffness: 400, damping: 38, mass: 0.9 };

// Page-level enter/exit, used by every route via AnimatePresence (mode="wait",
// so exit fully finishes before the next route enters).
//
// The enter and exit halves are deliberately asymmetric. Exit is a quick,
// slightly-shrinking lift-away on a short tween - it's the half the user is
// waiting through, so it gets out of the way fast and reads as "this page is
// leaving". Enter is the spring: it comes up from below at a hair under full
// size and settles, which is what gives the arrival its weight. Using a
// spring for BOTH made the handoff feel mushy, because two overlapping
// settle curves read as one long indecisive move rather than an exchange.
export const pageVariants = {
  initial: { opacity: 0, y: 16, scale: 0.985 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...spring, opacity: { duration: 0.28 } },
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.99,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
  },
};

// Stagger container for content that reveals after the morph settles.
export const staggerContainer = (delayChildren = 0.15) => ({
  initial: {},   // no visual state of its own - purely orchestrates children
  animate: {
    transition: { staggerChildren: 0.06, delayChildren },
  },
});

export const staggerItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: spring },
};
