import { motion } from "framer-motion";
import { pageVariants } from "../lib/motion";

export default function Ledger() {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen pt-28 px-6"
    >
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-semibold text-white">Ledger</h1>
        <p className="mt-2 text-sm text-white/40 font-body">
          Every decision this agent has made will live here — Phase 2.
        </p>
      </div>
    </motion.div>
  );
}
