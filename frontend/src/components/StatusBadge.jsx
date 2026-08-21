import { motion } from "framer-motion";

const STYLES = {
  completed: { dot: "bg-emerald-400", text: "text-emerald-700", label: "completed" },
  failed: { dot: "bg-rose-400", text: "text-rose-700", label: "failed" },
  awaiting_approval: { dot: "bg-amber-400", text: "text-amber-700", label: "needs input" },
  running: { dot: "bg-violet", text: "text-violet-soft", label: "running" },
};

export default function StatusBadge({ status }) {
  const s = STYLES[status] ?? STYLES.running;
  const live = status === "running" || status === "awaiting_approval";

  return (
    <span className={"inline-flex items-center gap-1.5 text-xs font-body " + s.text}>
      <motion.span
        className={"h-1.5 w-1.5 rounded-full " + s.dot}
        animate={live ? { opacity: [0.4, 1, 0.4] } : {}}
        transition={live ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : undefined}
      />
      {s.label}
    </span>
  );
}
