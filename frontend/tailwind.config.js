/**
 * PLACEHOLDER VALUES: the gradient stops and font families below were never
 * specified (the "master spec" referenced in the brief wasn't actually
 * attached). Everything else - the #16171C base, dark-only, spring-not-ease
 * transitions - came from the brief itself and is real, not a guess.
 * Swap `shopyx` gradient stops and the two font names below once the real
 * spec exists; nothing else in Phase 1 depends on their exact values.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class", // committed to dark; class stays on <html> permanently, no toggle
  theme: {
    extend: {
      colors: {
        base: "#16171C", // near-black, the only background this app has
        panel: "#1E2029", // one step up from base, for cards/surfaces
        edge: "#2A2D3A", // hairline borders against `base`/`panel`
        violet: {
          DEFAULT: "#8B5CF6",
          soft: "#C4B5FD", // "lavender" end of the named gradient
        },
      },
      backgroundImage: {
        // The named violet -> lavender gradient utility: `bg-shopyx`.
        shopyx: "linear-gradient(135deg, #7C3AED 0%, #8B5CF6 45%, #C4B5FD 100%)",
      },
      fontFamily: {
        // display: wordmark + headings. body: everything else.
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
      },
      transitionTimingFunction: {
        // CSS-only fallback for plain hover/focus transitions (color, opacity)
        // that don't go through Framer Motion. Not a real spring - CSS can't
        // simulate one - just a curve shaped like a spring's overshoot-settle.
        // Every *motion* transition (page changes, the layoutId morph) uses
        // the real spring physics config in src/lib/motion.js instead.
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};
