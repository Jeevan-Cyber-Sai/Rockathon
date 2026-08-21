import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimation } from "framer-motion";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { pageVariants, morphSpring, spring, staggerContainer, staggerItem } from "../lib/motion";
import { previewParse } from "../lib/previewParse";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { listRuns, postBrief } from "../lib/api";
import Chip from "../components/Chip";

const EXAMPLES = [
  "10 laptops, 16GB RAM, under ₹45,000, within 7 days",
  "5 office chairs, budget flexible, need them by Friday",
  "25 monitors, no more than ₹12,000 each, delivery within 5 days",
];

const PREVIEW_ORDER = ["quantity", "ram", "storage", "price", "delivery"];

// Matches adapters/quickcommerce.py's KNOWN_PLATFORMS exactly - the backend
// validates against its own live/fallback list too, so a stale name here
// just gets silently dropped server-side rather than breaking anything.
const QC_PLATFORMS = [
  "Flipkart", "Myntra", "Nykaa", "BlinkIt", "Zepto", "Swiggy",
  "BigBasket", "DMart", "JioMart", "Minutes", "Amazon",
];
const PINCODE_PLATFORMS = new Set(["DMart", "JioMart", "Minutes"]);

// A genuine spring shake: each leg is its own point-to-point spring (real
// overshoot-and-settle physics), chained with decaying amplitude - not a
// single linear back-and-forth tween.
const SHAKE_SPRING = { type: "spring", stiffness: 700, damping: 14, mass: 0.5 };
const SHAKE_STEPS = [-10, 8, -6, 4, -2, 0];

const FEATURES = [
  {
    accent: "violet",
    label: "Compares live prices",
    detail: "Real listings, fetched at ask time",
    icon: (
      <path d="M3 13h4l3 7 4-16 3 9h4" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    accent: "amber",
    label: "Splits orders automatically",
    detail: "Across vendors when it's cheaper",
    icon: (
      <>
        <path d="M3 12h6.5" strokeLinecap="round" />
        <path d="M9.5 12 16 5.5" strokeLinecap="round" />
        <path d="M9.5 12 16 18.5" strokeLinecap="round" />
        <path d="M12.5 5.5H16V9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12.5 18.5H16V15" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    accent: "violet",
    label: "Shows why, not just what",
    detail: "Every rule it bent, on the record",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
      </>
    ),
  },
  {
    accent: "amber",
    label: "Saves your search history",
    detail: "Pick up past comparisons anytime",
    link: "/ledger",
    icon: (
      <>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 7v5l4 2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
];

/** Purely decorative: soft blurred colour fields plus a faint grid, so the
 * page reads as a designed surface rather than flat off-white. Sits behind
 * the content, never intercepts a click. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, #C9BDEA 1px, transparent 1px)," +
            "linear-gradient(to bottom, #C9BDEA 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 90% 60% at 50% 35%, black 15%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 60% at 50% 35%, black 15%, transparent 75%)",
        }}
      />
      {/* Tints, not glows: on a light ground these read as washes of colour
          bleeding into the page rather than light sources on top of it. */}
      <div className="absolute -top-48 left-1/2 h-[40rem] w-[40rem] -translate-x-[72%] rounded-full bg-violet/20 blur-[130px]" />
      <div className="absolute -top-32 left-1/2 h-[28rem] w-[28rem] translate-x-[6%] rounded-full bg-amber/[0.16] blur-[120px]" />
      <div className="absolute bottom-[-16rem] left-1/2 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-violet-soft/25 blur-[140px]" />
    </div>
  );
}

export default function Brief() {
  const location = useLocation();
  const [text, setText] = useState(location.state?.initialText ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState([]);
  const navigate = useNavigate();
  const barControls = useAnimation();

  // ── QuickCommerce platform panel (optional, collapsed by default) ──
  // Closed + untouched, this changes nothing: handleSubmit only attaches a
  // location payload when selectedPlatforms is non-empty.
  const [showLocationPanel, setShowLocationPanel] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState(() => new Set());
  const [pincode, setPincode] = useState("");
  const [coords, setCoords] = useState(null);
  const [locationStatus, setLocationStatus] = useState("idle"); // idle | requesting | granted | denied | unsupported

  function togglePlatform(name) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
    if (error) setError(null);
  }

  function detectLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("unsupported");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocationStatus("granted");
      },
      () => setLocationStatus("denied"),
      { timeout: 10000 },
    );
  }

  // ── Speech-to-text ──
  const [listening, setListening] = useState(false);
  const [speechLang, setSpeechLang] = useState("en-IN"); // "en-IN" | "ta-IN"
  const recognitionRef = useRef(null);
  const textBeforeSpeechRef = useRef("");

  // Grab the SpeechRecognition constructor once
  const SpeechRecognitionCtor = useMemo(
    () =>
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null,
    [],
  );

  function startListening() {
    if (!SpeechRecognitionCtor) {
      setError("Speech recognition is not supported in this browser.");
      shakeBar();
      return;
    }

    // If one is already running, bail
    if (recognitionRef.current) return;

    // Snapshot whatever's in the box right now so we can append to it
    textBeforeSpeechRef.current = text;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = speechLang;
    recognition.interimResults = true;
    recognition.continuous = true;          // keep listening until user stops
    recognition.maxAlternatives = 1;

    let accumulated = "";                   // final transcript pieces this session

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let finals = "";
      let interim = "";

      for (let i = 0; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finals += chunk;
        } else {
          interim += chunk;
        }
      }

      accumulated = finals;
      const prefix = textBeforeSpeechRef.current;
      const combined = (prefix ? prefix + " " : "") + accumulated + (interim ? " " + interim : "");
      setText(combined.replace(/\s{2,}/g, " "));
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setError("Microphone permission was denied. Allow mic access and try again.");
        shakeBar();
      } else if (event.error === "no-speech") {
        setError("No speech detected — try speaking closer to the mic.");
        shakeBar();
      } else if (event.error !== "aborted") {
        setError(`Mic error: ${event.error}`);
        shakeBar();
      }
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }

  function toggleListening() {
    listening ? stopListening() : startListening();
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  // Load recent searches on mount from API and localStorage
  useEffect(() => {
    let cancelled = false;
    listRuns(6)
      .then((rows) => {
        if (cancelled) return;
        if (rows && rows.length > 0) {
          setRecentSearches(rows.slice(0, 5));
        } else {
          // Fallback to local storage if API has no runs yet
          try {
            const local = JSON.parse(localStorage.getItem("shopyx_recent_searches") || "[]");
            if (local.length > 0) setRecentSearches(local);
          } catch {}
        }
      })
      .catch(() => {
        try {
          const local = JSON.parse(localStorage.getItem("shopyx_recent_searches") || "[]");
          if (local.length > 0 && !cancelled) setRecentSearches(local);
        } catch {}
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const debouncedText = useDebouncedValue(text, 500);
  const previewChips = useMemo(() => previewParse(debouncedText), [debouncedText]);
  const showPreview = debouncedText.trim().length > 0 && Object.keys(previewChips).length > 0;

  // Rotate the empty-state placeholder through real example briefs so the
  // blank input teaches by example rather than sitting empty.
  useEffect(() => {
    if (text) return; // only cycle while genuinely empty
    const id = setInterval(() => setPlaceholderIndex((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(id);
  }, [text]);

  async function shakeBar() {
    for (const x of SHAKE_STEPS) {
      await barControls.start({ x }, SHAKE_SPRING);
    }
  }

  async function handleSubmit(e, customText) {
    if (e) e.preventDefault();
    // Stop listening if the user submits while mic is on
    if (listening) stopListening();
    const query = (customText ?? text).trim();
    if (!query || submitting) return;

    // Same rule the backend itself enforces (a real 400 if violated) -
    // checked here first so choosing platforms without detecting location
    // doesn't cost a round trip to find out.
    const platforms = Array.from(selectedPlatforms);
    if (platforms.length > 0 && !coords) {
      setError("Detect your location first, or clear the selected platforms.");
      shakeBar();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // Optimistically store in local storage history
      try {
        const existing = JSON.parse(localStorage.getItem("shopyx_recent_searches") || "[]");
        const updated = [{ brief_text: query, created_at: new Date().toISOString() }, ...existing.filter(x => x.brief_text !== query)].slice(0, 10);
        localStorage.setItem("shopyx_recent_searches", JSON.stringify(updated));
      } catch {}

      // undefined (not an object with empty platforms) when the panel was
      // never used - postBrief then sends exactly {text}, unchanged from
      // before QuickCommerce existed.
      const qcLocation = platforms.length > 0
        ? { lat: coords.lat, lon: coords.lon, ...(pincode.length === 6 ? { pincode } : {}), platforms }
        : undefined;

      const { run_id } = await postBrief(query, qcLocation);
      // Navigate on success only - the bar's layoutId morph is what carries
      // it into the Compare header. Nothing to reset: this component unmounts.
      navigate(`/compare/${run_id}`, { state: { briefText: query } });
    } catch (err) {
      setSubmitting(false);
      setError(err.message);
      shakeBar();
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24">
      <Backdrop />

      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative z-10 w-full max-w-3xl flex flex-col items-center gap-8 text-center"
      >
        <motion.div
          variants={staggerContainer(0.08)}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-4"
        >
          <motion.img
            variants={staggerItem}
            src="/logo-full.png"
            alt="Shopyx"
            draggable={false}
            className="h-20 sm:h-24 w-auto select-none drop-shadow-[0_10px_28px_rgba(124,58,237,0.22)]"
          />

          <motion.h1
            variants={staggerItem}
            className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-ink
                       leading-[1.1] max-w-2xl"
          >
            Describe what you need.
            <br />
            <span className="bg-shopyx bg-clip-text text-transparent">
              Get the buy, and the reasoning.
            </span>
          </motion.h1>

          <motion.p
            variants={staggerItem}
            className="max-w-xl text-[14.5px] leading-relaxed text-ink/55 font-body"
          >
            It reads your brief in plain English, compares live listings across vendors,
            splits the order when that lands a better price, and shows exactly which rules
            it had to bend to get there.
          </motion.p>

          <motion.ul
            variants={staggerItem}
            className="mt-1 flex flex-wrap items-stretch justify-center gap-2.5"
          >
            {FEATURES.map((f) => {
              const content = (
                <>
                  <span
                    className={
                      "grid h-7 w-7 shrink-0 place-items-center rounded-lg " +
                      (f.accent === "amber"
                        ? "bg-amber/15 text-amber"
                        : "bg-violet/12 text-violet-deep")
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-4 w-4"
                    >
                      {f.icon}
                    </svg>
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[12.5px] font-semibold text-ink/85 font-body leading-tight">
                      {f.label}
                    </span>
                    <span className="text-[11px] text-ink/35 font-body leading-tight mt-0.5">
                      {f.detail}
                    </span>
                  </span>
                </>
              );

              return f.link ? (
                <Link
                  key={f.label}
                  to={f.link}
                  className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/80
                             px-3.5 py-2.5 backdrop-blur-sm text-left
                             shadow-sm shadow-violet/[0.06] transition-all hover:border-violet/40 hover:bg-panel hover:scale-[1.02]"
                >
                  {content}
                </Link>
              ) : (
                <li
                  key={f.label}
                  className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel/80
                             px-3.5 py-2.5 backdrop-blur-sm text-left
                             shadow-sm shadow-violet/[0.06]"
                >
                  {content}
                </li>
              );
            })}
          </motion.ul>
        </motion.div>

        <div className="w-full max-w-2xl">
          <div
            className="rounded-2xl border border-edge bg-panel/85 p-4 sm:p-5
                       shadow-xl shadow-violet/10 backdrop-blur-md"
          >
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/40 font-body">
                Start your search
              </span>
            </div>

            {/* Shake and layoutId are deliberately on two different elements.
                Framer Motion's layout-projection system (from layoutId) and an
                imperative x-offset animation (from animate={barControls})
                fight over the same node's transform if combined directly - the
                projected layout transform wins and the shake never visibly
                moves. The outer div owns the shake; the inner form owns only
                the cross-route morph, untouched by it. */}
            <motion.div animate={barControls}>
              <motion.form
                layoutId="brief-bar"
                transition={{ layout: morphSpring }}
                onSubmit={handleSubmit}
                className={
                  "w-full rounded-xl bg-base border px-5 py-4 flex items-center gap-3 " +
                  "transition-shadow duration-150 " +
                  // The input's own outline is suppressed below - a square
                  // ring on a child inside this rounded bar would look like a
                  // bug, not a focus state. focus-within moves the visible
                  // indicator to the bar itself instead of removing it.
                  "focus-within:ring-2 focus-within:ring-violet/50 " +
                  (error ? "border-rose-500/50" : "border-edge")
                }
              >
                <input
                  autoFocus
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder={EXAMPLES[placeholderIndex]}
                  className="flex-1 min-w-0 bg-transparent text-base text-ink placeholder:text-ink/35
                             outline-none font-body"
                />

                {/* Language toggle + Mic button — hidden entirely if browser
                    doesn't support the Web Speech API (graceful degradation). */}
                {SpeechRecognitionCtor && (
                  <>
                    {/* Compact language toggle */}
                    <div
                      className="shrink-0 flex rounded-full border border-edge bg-base overflow-hidden
                                 text-[10px] font-semibold font-body select-none"
                    >
                      <button
                        type="button"
                        onClick={() => { setSpeechLang("en-IN"); if (error) setError(null); }}
                        className={
                          "px-2 py-1 transition-colors duration-150 " +
                          (speechLang === "en-IN"
                            ? "bg-violet/15 text-violet"
                            : "text-ink/40 hover:text-ink/60")
                        }
                      >
                        EN
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSpeechLang("ta-IN"); if (error) setError(null); }}
                        className={
                          "px-2 py-1 transition-colors duration-150 " +
                          (speechLang === "ta-IN"
                            ? "bg-violet/15 text-violet"
                            : "text-ink/40 hover:text-ink/60")
                        }
                      >
                        தமி
                      </button>
                    </div>

                    {/* Mic button for speech-to-text */}
                    <motion.button
                      type="button"
                      onClick={toggleListening}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      title={
                        listening
                          ? "Stop listening"
                          : `Speak your search (${speechLang === "ta-IN" ? "Tamil" : "English"})`
                      }
                      className={
                        "relative shrink-0 grid h-9 w-9 place-items-center rounded-full transition-colors duration-200 " +
                        (listening
                          ? "bg-rose-500/15 text-rose-500"
                          : "bg-violet/10 text-violet hover:bg-violet/20")
                      }
                    >
                      {listening && (
                        <motion.span
                          className="absolute inset-0 rounded-full border-2 border-rose-500/60"
                          initial={{ scale: 1, opacity: 0.8 }}
                          animate={{ scale: 1.6, opacity: 0 }}
                          transition={{ repeat: Infinity, duration: 1.2, ease: "easeOut" }}
                        />
                      )}
                      {listening && (
                        <motion.span
                          className="absolute inset-0 rounded-full border-2 border-rose-500/40"
                          initial={{ scale: 1, opacity: 0.6 }}
                          animate={{ scale: 2, opacity: 0 }}
                          transition={{ repeat: Infinity, duration: 1.2, ease: "easeOut", delay: 0.3 }}
                        />
                      )}
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4.5 w-4.5 relative z-10"
                      >
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                      </svg>
                    </motion.button>
                  </>
                )}

                {/* Dark ink on the amber fill rather than white: the light
                    end of the gradient is too pale to carry white text. */}
                <motion.button
                  type="submit"
                  disabled={!text.trim() || submitting}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  className="shrink-0 w-24 rounded-lg bg-sunrise py-2 text-sm font-semibold text-ink
                             shadow-md shadow-amber/25
                             disabled:opacity-40 disabled:shadow-none transition-opacity duration-200
                             flex items-center justify-center"
                >
                  {submitting ? (
                    <motion.span
                      className="h-3.5 w-3.5 rounded-full border-2 border-ink/30 border-t-ink"
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                    />
                  ) : (
                    "Find it"
                  )}
                </motion.button>
              </motion.form>
            </motion.div>

            <AnimatePresence mode="wait">
              {error ? (
                <motion.p
                  key="error"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={spring}
                  className="mt-3 px-1 text-sm text-rose-600 font-body text-left"
                >
                  Couldn't submit that: {error}
                </motion.p>
              ) : showPreview ? (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={spring}
                  className="mt-3 flex flex-col items-center gap-2"
                >
                  <span className="text-[11px] uppercase tracking-wide text-ink/30 font-body">
                    detecting…
                  </span>
                  <div className="flex flex-wrap justify-center gap-2">
                    {PREVIEW_ORDER.filter((k) => previewChips[k]).map((k) => (
                      <Chip key={k} mode="preview" label={previewChips[k]} />
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Listening indicator below the bar */}
            <AnimatePresence>
              {listening && (
                <motion.div
                  key="mic-status"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={spring}
                  className="mt-3 flex items-center justify-center gap-2"
                >
                  <motion.span
                    className="h-2 w-2 rounded-full bg-rose-500"
                    animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                    transition={{ repeat: Infinity, duration: 1, ease: "easeInOut" }}
                  />
                  <span className="text-[12px] font-medium text-rose-500/80 font-body">
                    Listening ({speechLang === "ta-IN" ? "Tamil" : "English"})… speak your search
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* QuickCommerce platform panel - collapsed by default, so
                nothing here changes behavior unless it's opened. */}
            <button
              type="button"
              onClick={() => setShowLocationPanel((v) => !v)}
              className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-ink/40
                         hover:text-violet transition-colors font-body"
            >
              <motion.span
                animate={{ rotate: showLocationPanel ? 90 : 0 }}
                transition={spring}
                className="inline-block"
              >
                ▸
              </motion.span>
              Search more platforms (optional)
              {selectedPlatforms.size > 0 && (
                <span className="rounded-full bg-violet/10 text-violet px-1.5 py-0.5 text-[10px] font-semibold">
                  {selectedPlatforms.size}
                </span>
              )}
            </button>

            <AnimatePresence initial={false}>
              {showLocationPanel && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring}
                  className="overflow-hidden"
                >
                  <div className="mt-3 rounded-xl border border-edge bg-base/60 p-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={detectLocation}
                        disabled={locationStatus === "requesting"}
                        className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel px-3 py-1.5
                                   text-xs font-medium text-ink/70 hover:border-violet/40 hover:text-violet
                                   transition-colors disabled:opacity-50 font-body"
                      >
                        📍{" "}
                        {locationStatus === "granted"
                          ? "Location detected"
                          : locationStatus === "requesting"
                            ? "Detecting…"
                            : locationStatus === "denied"
                              ? "Retry location"
                              : "Detect my location"}
                      </button>
                      {locationStatus === "granted" && coords && (
                        <span className="text-[11px] text-emerald-700 font-body">
                          ✓ {coords.lat.toFixed(3)}, {coords.lon.toFixed(3)}
                        </span>
                      )}
                      {locationStatus === "denied" && (
                        <span className="text-[11px] text-rose-600 font-body">
                          Location access denied — needed to search these platforms
                        </span>
                      )}
                      {locationStatus === "unsupported" && (
                        <span className="text-[11px] text-rose-600 font-body">
                          Not supported in this browser
                        </span>
                      )}
                      <input
                        value={pincode}
                        onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="Pincode (for DMart, JioMart, Minutes)"
                        inputMode="numeric"
                        className="flex-1 min-w-[200px] rounded-lg border border-edge bg-panel px-3 py-1.5
                                   text-xs text-ink placeholder:text-ink/30 outline-none
                                   focus:border-violet/40 font-body"
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {QC_PLATFORMS.map((p) => {
                        const active = selectedPlatforms.has(p);
                        const needsPincode = PINCODE_PLATFORMS.has(p) && pincode.length !== 6;
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePlatform(p)}
                            title={needsPincode ? `${p} also needs a 6-digit pincode above` : undefined}
                            className={
                              "rounded-full px-3 py-1 text-[11px] font-medium border transition-colors font-body " +
                              (active
                                ? "bg-violet text-white border-violet"
                                : "bg-panel text-ink/60 border-edge hover:border-violet/40") +
                              (needsPincode ? " ring-1 ring-amber/50" : "")
                            }
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-2.5 text-[10.5px] text-ink/35 font-body leading-relaxed">
                      Searches real listings on the platforms you pick, alongside Amazon. Each
                      platform is a real request against the provider - pick only what you need.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="mt-3 text-[11.5px] text-ink/25 font-body">
            Plain English works best — quantity, specs, budget, timeline. Or tap the mic to speak.
          </p>

          {/* Instant Recent Searches & History Widget */}
          {recentSearches && recentSearches.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, ...spring }}
              className="mt-4 rounded-xl border border-edge/80 bg-panel/70 p-3.5 backdrop-blur-sm shadow-sm"
            >
              <div className="flex items-center justify-between px-1 mb-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink/60 font-body">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5 text-violet"
                  >
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l4 2" />
                  </svg>
                  <span>Recent Searches</span>
                </div>
                <Link
                  to="/ledger"
                  className="text-[11.5px] font-semibold text-violet hover:underline flex items-center gap-0.5"
                >
                  <span>Full History</span>
                  <span>&rarr;</span>
                </Link>
              </div>

              <div className="flex flex-wrap gap-2">
                {recentSearches.map((item, idx) => {
                  const queryText = item.brief_text || item;
                  return (
                    <button
                      key={item.id || idx}
                      type="button"
                      onClick={() => {
                        if (item.id) {
                          navigate(`/compare/${item.id}`, { state: { briefText: queryText } });
                        } else {
                          setText(queryText);
                          handleSubmit(null, queryText);
                        }
                      }}
                      className="group flex items-center gap-1.5 rounded-lg border border-edge bg-base/80 px-2.5 py-1.5 text-xs text-ink/75 transition-all hover:border-violet/40 hover:bg-panel hover:text-violet shadow-sm"
                    >
                      <span className="truncate max-w-[200px] text-left">{queryText}</span>
                      <span className="text-[10px] text-ink/35 group-hover:text-violet/60">
                        {item.status ? `• ${item.status}` : "↗"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

