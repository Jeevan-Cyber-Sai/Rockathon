/**
 * Light theme, violet-led - the palette is pulled from the Shopyx logo's
 * purple. `ink` is the text colour and is used with opacity the same way
 * `white` was in the old dark theme (ink/40 = muted, ink/70 = secondary,
 * ink = primary), so tone hierarchy survived the switch unchanged.
 */
import colors from "tailwindcss/colors";

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        base: "#F7F5FC", // page background - off-white with a lavender cast
        panel: "#FFFFFF", // cards/surfaces sitting on `base`
        edge: "#E7E2F4", // hairline borders against `base`/`panel`
        ink: "#241C42", // primary text - deep violet-navy, not pure black
        // Both of these spread Tailwind's own scale first: naming a colour
        // `violet`/`amber` with only DEFAULT would REPLACE the built-in
        // palette, and every existing `amber-400`/`rose-500`-style class in
        // the components would silently stop resolving.
        violet: {
          ...colors.violet,
          DEFAULT: "#7C3AED", // darkened one stop from the old #8B5CF6 so it
          soft: "#A78BFA", // still passes contrast on a light background
          deep: "#5B21B6", // for text that must sit on a pale violet fill
        },
        // Secondary warm accent - highlights, price callouts, the Brief CTA.
        amber: {
          ...colors.amber,
          DEFAULT: "#E08A00",
          soft: "#FFB648",
        },

        // --- landing page palette -------------------------------------
        // From the supplied first_page design. Each carries the
        // <alpha-value> placeholder so Tailwind's `/opacity` modifiers
        // (text-brand-ink/70, bg-surface/40, ...) resolve - without it a
        // plain oklch string can't have alpha injected in v3.
        brand: {
          DEFAULT: "oklch(0.52 0.23 295 / <alpha-value>)",
          deep: "oklch(0.33 0.17 293 / <alpha-value>)",
          ink: "oklch(0.24 0.09 292 / <alpha-value>)",
          soft: "oklch(0.93 0.045 300 / <alpha-value>)",
        },
        peach: "oklch(0.94 0.045 62 / <alpha-value>)",
        cream: "oklch(0.985 0.008 85 / <alpha-value>)",
        surface: "oklch(0.995 0.003 90 / <alpha-value>)",
        // The source defines this as a 14%-alpha violet. Expressed here as
        // the equivalent solid tone so the `/opacity` modifiers still work;
        // at full alpha it matches the original's rendered weight.
        hairline: "oklch(0.92 0.015 295 / <alpha-value>)",
      },
      backgroundImage: {
        shopyx: "linear-gradient(135deg, #6D28D9 0%, #7C3AED 45%, #A78BFA 100%)",
        sunrise: "linear-gradient(135deg, #F59E0B 0%, #F5A524 55%, #FFC46B 100%)",
      },
      fontFamily: {
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
