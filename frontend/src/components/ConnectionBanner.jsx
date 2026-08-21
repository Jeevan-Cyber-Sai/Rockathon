import { AnimatePresence, motion } from "framer-motion";
import { spring } from "../lib/motion";

/** Only renders when there's actually something wrong - "connected" (the
 * normal case) shows nothing, so this never adds visual noise to a run
 * that's working fine. */
export default function ConnectionBanner({ status }) {
  if (status === "connected") return null;

  const copy = {
    reconnecting: { text: "Reconnecting…", tone: "text-amber-700" },
    disconnected: { text: "Lost connection to the server - refresh to keep watching this run.", tone: "text-rose-700" },
  }[status];
  if (!copy) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={spring}
        className={"flex items-center gap-2 text-xs font-body " + copy.tone}
      >
        {status === "reconnecting" && (
          <motion.span
            className="h-2.5 w-2.5 rounded-full border-2 border-current border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
          />
        )}
        {copy.text}
      </motion.div>
    </AnimatePresence>
  );
}
