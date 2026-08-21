import { motion } from "framer-motion";

/**
 * Persistent across every route - lives outside AnimatePresence in App.jsx,
 * so it never unmounts/remounts on navigation. Wordmark + a status indicator,
 * nothing else, per spec. The indicator isn't wired to anything real yet
 * (no backend in Phase 1) - it's a gentle pulse standing in for the pipeline
 * progress feed that lands in a later phase.
 */
export default function TopBar() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4">
      <span className="font-display text-sm font-semibold tracking-wide bg-shopyx bg-clip-text text-transparent">
        Shopyx
      </span>

      <div className="flex items-center gap-2">
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-violet"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="h-px w-10 bg-edge" />
      </div>
    </header>
  );
}
