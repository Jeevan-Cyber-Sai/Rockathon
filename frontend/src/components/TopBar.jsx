import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";
import { spring } from "../lib/motion";

/**
 * Persistent across every route - lives outside AnimatePresence in App.jsx,
 * so it never unmounts/remounts on navigation. The logo doubles as the way
 * home; the pulse on the right stands in for the pipeline progress feed.
 */
export default function TopBar() {
  // The landing and login pages ship their own header/logo, so this bar would
  // be a second one stacked on top of them.
  const { pathname } = useLocation();
  if (pathname === "/" || pathname === "/login") return null;

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-3
                 bg-base/70 backdrop-blur-md border-b border-edge/60"
    >
      <Link
        to="/"
        aria-label="Shopyx - back to home"
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet/50"
      >
        <motion.img
          src="/logo-full.png"
          alt="Shopyx"
          className="h-10 w-auto select-none"
          draggable={false}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
        />
      </Link>

      <div className="flex items-center gap-2">
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-violet"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="h-px w-10 bg-edge" />
      </div>
    </header>
  );
}
