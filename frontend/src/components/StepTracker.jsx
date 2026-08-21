import { motion } from "framer-motion";
import { spring } from "../lib/motion";

const STEPS = [
  { key: "parsed", label: "Understood" },
  { key: "fetched", label: "Searched" },
  { key: "filtered", label: "Filtered" },
  { key: "scored", label: "Ranked" },
  { key: "decided", label: "Decided" },
];

/** Sequential labels, not a spinner - each lights up as its stage's
 * WebSocket event actually arrives. "awaiting_approval" counts as having
 * reached the "decided" step (a decision was reached, it just needs input),
 * so approving and reaching "completed" doesn't regress the tracker. */
export default function StepTracker({ doneStages }) {
  const isDone = (key) =>
    doneStages.has(key) || (key === "decided" && doneStages.has("awaiting_approval"));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((step, i) => {
        const done = isDone(step.key);
        const prevDone = i === 0 || isDone(STEPS[i - 1].key);
        const isCurrent = !done && prevDone;

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <motion.span
                className="h-1.5 w-1.5 rounded-full"
                animate={{
                  backgroundColor: done ? "#8B5CF6" : isCurrent ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.15)",
                  scale: isCurrent ? [1, 1.5, 1] : 1,
                }}
                transition={isCurrent
                  ? { scale: { repeat: Infinity, duration: 1.1, ease: "easeInOut" }, backgroundColor: spring }
                  : spring}
              />
              <span className={"text-xs font-body " + (done ? "text-ink/70" : "text-ink/30")}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && <span className="w-4 h-px bg-ink/10" />}
          </div>
        );
      })}
    </div>
  );
}
