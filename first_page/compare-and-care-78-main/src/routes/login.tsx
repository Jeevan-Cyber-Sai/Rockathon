import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import logo from "@/assets/shopyx-logo.png.asset.json";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in to Shopyx — Compare every store in one search" },
      {
        name: "description",
        content:
          "Sign in to Shopyx to save comparisons, track price drops and reorder in bulk across Amazon, Flipkart, Croma and more.",
      },
      { property: "og:title", content: "Log in to Shopyx" },
      {
        property: "og:description",
        content: "Sign in to save comparisons and track price drops across every major store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");

  return (
    <main className="mesh-bg grid-veil relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div className="rise w-full max-w-md">
        <Link to="/" className="mx-auto mb-8 block w-fit">
          <img src={logo.url} alt="Shopyx" className="h-20 w-auto" />
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
            }}
          >
            {mode === "signup" && (
              <label className="block">
                <span className="text-xs uppercase tracking-[0.2em] text-brand-ink/50">Name</span>
                <input
                  className="mt-2 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 text-sm text-brand-ink outline-none transition-colors focus:border-brand/50"
                  placeholder="Jeevan Sai"
                  autoComplete="name"
                />
              </label>
            )}
            <label className="block">
              <span className="text-xs uppercase tracking-[0.2em] text-brand-ink/50">Email</span>
              <input
                type="email"
                className="mt-2 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 text-sm text-brand-ink outline-none transition-colors focus:border-brand/50"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-[0.2em] text-brand-ink/50">Password</span>
              <input
                type="password"
                className="mt-2 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 text-sm text-brand-ink outline-none transition-colors focus:border-brand/50"
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
    </main>
  );
}
