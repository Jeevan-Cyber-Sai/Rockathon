import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

const loginVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

const FIELD_CLASS =
  "mt-2 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 text-sm " +
  "text-brand-ink outline-none transition-colors focus:border-brand/50 focus:bg-surface";
const LABEL_CLASS = "text-xs uppercase tracking-[0.2em] text-brand-ink/50 font-medium";

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const { user, isConfigured, signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // If already logged in, redirect to /search
  useEffect(() => {
    if (user) {
      const destination = location.state?.from || "/search";
      navigate(destination, { replace: true });
    }
  }, [user, navigate, location]);

  useEffect(() => {
    document.title =
      mode === "signup"
        ? "Create Account — Shopyx"
        : mode === "forgot"
        ? "Reset Password — Shopyx"
        : "Log In to Shopyx — Compare Every Store";
  }, [mode]);

  async function handleEmailAuth(e) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (mode !== "forgot" && !password) {
      setError("Please enter your password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (mode === "login") {
        const { error: authErr } = await signInWithEmail(email.trim(), password);
        if (authErr) throw authErr;
        navigate("/search");
      } else if (mode === "signup") {
        const { data, error: authErr } = await signUpWithEmail(
          email.trim(),
          password,
          fullName.trim()
        );
        if (authErr) throw authErr;

        // If email confirmation is enabled on Supabase project:
        if (data?.user && !data.session) {
          setSuccessMsg(
            "Account created! Please check your email inbox to confirm your account before logging in."
          );
        } else {
          navigate("/search");
        }
      }
    } catch (err) {
      setError(err.message || "Authentication failed. Please check your credentials.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setSubmitting(true);
    setError(null);
    try {
      const { error: authErr } = await signInWithGoogle();
      if (authErr) throw authErr;
    } catch (err) {
      setError(err.message || "Failed to sign in with Google.");
      setSubmitting(false);
    }
  }

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
          {/* Header text */}
          <h1 className="text-2xl text-brand-ink font-semibold">
            {mode === "login"
              ? "Welcome back"
              : mode === "signup"
              ? "Create your account"
              : "Reset password"}
          </h1>
          <p className="mt-2 text-sm text-brand-ink/60">
            {mode === "login"
              ? "Pick up your saved comparisons and price alerts."
              : mode === "signup"
              ? "Save comparisons, track price drops, buy across stores."
              : "Enter your email to receive password reset instructions."}
          </p>

          {/* Configuration status badge if in local demo mode */}
          {!isConfigured && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
              <span>⚡</span>
              <span>
                <strong>Demo Mode Active</strong> — add Supabase keys to <code>.env</code> for live cloud database auth.
              </span>
            </div>
          )}

          {/* Social login buttons */}
          {mode !== "forgot" && (
            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={submitting}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-hairline bg-surface/90 px-4 py-3 text-sm font-medium text-brand-ink shadow-sm transition-all hover:bg-surface hover:border-brand/40 hover:shadow-md active:scale-[0.99] disabled:opacity-60"
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
          )}

          {mode !== "forgot" && (
            <div className="relative my-6 flex items-center justify-center">
              <div className="w-full border-t border-hairline"></div>
              <span className="bg-surface/90 px-3 text-[11px] uppercase tracking-wider text-brand-ink/40 font-medium">
                Or continue with email
              </span>
              <div className="w-full border-t border-hairline"></div>
            </div>
          )}

          {/* Feedback messages */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 leading-relaxed"
              >
                {error}
              </motion.div>
            )}
            {successMsg && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-700 leading-relaxed"
              >
                {successMsg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form className="space-y-4" onSubmit={handleEmailAuth}>
            {mode === "signup" && (
              <label className="block">
                <span className={LABEL_CLASS}>Full Name</span>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="Jeevan Sai"
                  autoComplete="name"
                />
              </label>
            )}

            <label className="block">
              <span className={LABEL_CLASS}>Email address</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD_CLASS}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            {mode !== "forgot" && (
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className={LABEL_CLASS}>Password</span>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => { setMode("forgot"); setError(null); setSuccessMsg(null); }}
                      className="text-[11px] text-brand hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={FIELD_CLASS}
                  placeholder="••••••••"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </label>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-brand px-6 py-3.5 text-sm font-medium text-cream shadow-[var(--shadow-lift)] transition-all hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <span className="h-4 w-4 rounded-full border-2 border-cream/40 border-t-cream animate-spin" />
              ) : mode === "login" ? (
                "Log in"
              ) : mode === "signup" ? (
                "Create account"
              ) : (
                "Send Reset Link"
              )}
            </button>
          </form>

          {/* Guest / Skip Option */}
          <div className="mt-4 pt-4 border-t border-hairline/60 text-center">
            <button
              type="button"
              onClick={() => navigate("/search")}
              className="text-xs font-medium text-brand-ink/50 hover:text-brand transition-colors"
            >
              Continue as Guest &rarr;
            </button>
          </div>

          {/* Toggle between login/signup/forgot */}
          <p className="mt-5 text-center text-sm text-brand-ink/60">
            {mode === "login" ? (
              <>
                New to Shopyx?{" "}
                <button
                  type="button"
                  className="story-link text-brand font-medium"
                  onClick={() => { setMode("signup"); setError(null); setSuccessMsg(null); }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="story-link text-brand font-medium"
                  onClick={() => { setMode("login"); setError(null); setSuccessMsg(null); }}
                >
                  Log in
                </button>
              </>
            )}
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

