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

          <div className="mt-6">
            <button
              type="button"
              onClick={() => navigate("/search")}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-hairline bg-surface/90 px-4 py-3 text-sm font-medium text-brand-ink shadow-sm transition-all hover:bg-surface hover:border-brand/40 hover:shadow-md active:scale-[0.99]"
            >
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>

          <div className="relative my-6 flex items-center justify-center">
            <div className="w-full border-t border-hairline"></div>
            <span className="bg-surface/90 px-3 text-[11px] uppercase tracking-wider text-brand-ink/40">
              Or continue with email
            </span>
            <div className="w-full border-t border-hairline"></div>
          </div>

          <form
            className="space-y-4"
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
