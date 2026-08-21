import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";
import { spring } from "../lib/motion";
import { useAuth } from "../lib/AuthContext";

/**
 * Persistent across every route - lives outside AnimatePresence in App.jsx,
 * so it never unmounts/remounts on navigation. The logo doubles as the way
 * home; the pulse on the right stands in for the pipeline progress feed.
 */
export default function TopBar() {
  // The landing and login pages ship their own header/logo, so this bar would
  // be a second one stacked on top of them.
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();

  if (pathname === "/" || pathname === "/login") return null;

  const displayName =
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "Guest";

  const initialLetter = displayName.charAt(0).toUpperCase();

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-3
                 bg-base/80 backdrop-blur-md border-b border-edge/60"
    >
      <div className="flex items-center gap-6">
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

        <nav className="flex items-center gap-1">
          <Link
            to="/search"
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              pathname === "/search"
                ? "bg-violet/10 text-violet font-semibold"
                : "text-ink/60 hover:text-ink hover:bg-ink/[0.04]"
            }`}
          >
            New Search
          </Link>
          <Link
            to="/ledger"
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              pathname === "/ledger"
                ? "bg-violet/10 text-violet font-semibold"
                : "text-ink/60 hover:text-ink hover:bg-ink/[0.04]"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l4 2" />
            </svg>
            <span>History</span>
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-4">
        {user ? (
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 rounded-full border border-edge bg-panel px-3 py-1 text-xs text-ink/80 shadow-sm">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-violet/20 text-[10px] font-bold text-violet">
                {initialLetter}
              </span>
              <span className="font-medium max-w-[130px] truncate">{displayName}</span>
            </div>
            <button
              type="button"
              onClick={signOut}
              title="Sign out"
              className="rounded-lg border border-edge bg-panel px-2.5 py-1 text-xs text-ink/60 hover:border-rose-500/30 hover:text-rose-500 hover:bg-rose-500/5 transition-all"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className="rounded-lg bg-violet px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-violet-deep transition-all"
          >
            Log in
          </Link>
        )}

        <div className="hidden sm:flex items-center gap-2 border-l border-edge pl-3">
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-violet"
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="h-px w-6 bg-edge" />
        </div>
      </div>
    </header>
  );
}
