import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";

/**
 * Log in / sign up, ported from the supplied first_page design.
 *
 * There is no auth backend, exactly as in the source - the form validates
 * nothing and stores nothing. The one addition is that submitting continues
 * into the search, so the page isn't a dead end in this app.
 */

// Opacity only - a transform here would become the containing block for any
// fixed-position child, same reason as Landing.
const loginVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.35 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

const FIELD_CLASS =
  "mt-2 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 text-sm " +
  "text-brand-ink outline-none transition-colors focus:border-brand/50";
const LABEL_CLASS = "text-xs uppercase tracking-[0.2em] text-brand-ink/50";

export default function Login() {
  const [mode, setMode] = useState("login");
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Log in to Shopyx — Compare every store in one search";
  }, []);

  return (
    <motion.main
      variants={loginVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="landing mesh-bg grid-veil relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16"
    >
      <div className="rise w-full max-w-md">
        <Link to="/" className="mx-auto mb-8 block w-fit">
          <img src="/logo-full.png" alt="Shopyx" className="h-20 w-auto" />
        </Link>

        <div className="rounded-3xl border border-hairline bg-surface/85 p-8 shadow-[var(--shadow-card)] backdrop-blur">
          <h1 className="text-2xl text-brand-ink">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-brand-ink/60">
            {mode === "login"
              ? "Pick up your saved comparisons and price alerts."
              : "Save comparisons, track price drops, buy in bulk."}
          </p>

          <form
            className="mt-7 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              navigate("/search");
            }}
          >
            {mode === "signup" && (
              <label className="block">
                <span className={LABEL_CLASS}>Name</span>
                <input className={FIELD_CLASS} placeholder="Jeevan Sai" autoComplete="name" />
              </label>
            )}
            <label className="block">
              <span className={LABEL_CLASS}>Email</span>
              <input
                type="email"
                className={FIELD_CLASS}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <label className="block">
              <span className={LABEL_CLASS}>Password</span>
              <input
                type="password"
                className={FIELD_CLASS}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-xl bg-brand px-6 py-3 text-sm font-medium text-cream shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5"
            >
              {mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-brand-ink/60">
            {mode === "login" ? "New to Shopyx?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="story-link text-brand"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Create an account" : "Log in"}
            </button>
          </p>
        </div>

        <Link
          to="/"
          className="mt-6 block text-center text-sm text-brand-ink/45 transition-colors hover:text-brand"
        >
          &larr; Back to home
        </Link>
      </div>
    </motion.main>
  );
}
