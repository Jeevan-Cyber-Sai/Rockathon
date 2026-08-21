import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SPARKS = [
  { x: -5.2, d: 1.1, s: 0.5, color: "#e0b0ff" },
  { x: -3.8, d: 1.3, s: 0.7, color: "#ffd700" },
  { x: -2.1, d: 1.0, s: 0.4, color: "#c084fc" },
  { x: -0.8, d: 1.5, s: 0.8, color: "#ffffff" },
  { x: 0.9, d: 1.2, s: 0.6, color: "#ffd700" },
  { x: 2.4, d: 1.4, s: 0.5, color: "#e9d5ff" },
  { x: 4.1, d: 1.1, s: 0.7, color: "#c084fc" },
  { x: 5.5, d: 1.6, s: 0.4, color: "#fef08a" },
  { x: -4.5, d: 1.7, s: 0.5, color: "#f3e8ff" },
  { x: -1.5, d: 1.8, s: 0.6, color: "#ffd700" },
  { x: 1.8, d: 1.9, s: 0.7, color: "#a855f7" },
  { x: 3.6, d: 2.0, s: 0.5, color: "#ffffff" },
];

const STORE_BUBBLES = [
  { name: "Amazon", logo: "https://www.google.com/s2/favicons?domain=amazon.in&sz=64", delay: 1.6, x: -90, y: -40, scale: 0.85 },
  { name: "Flipkart", logo: "https://www.google.com/s2/favicons?domain=flipkart.com&sz=64", delay: 1.9, x: 95, y: -30, scale: 0.9 },
  { name: "Blinkit", logo: "https://www.google.com/s2/favicons?domain=blinkit.com&sz=64", delay: 2.1, x: -115, y: 35, scale: 0.75 },
  { name: "DMart", logo: "https://www.google.com/s2/favicons?domain=dmart.in&sz=64", delay: 2.3, x: 110, y: 45, scale: 0.8 },
  { name: "Croma", logo: "https://www.google.com/s2/favicons?domain=croma.com&sz=64", delay: 2.5, x: 0, y: -95, scale: 0.8 },
];

const STARS = [
  { top: "8%", left: "10%", size: 16, delay: "0.1s", duration: "2.2s", type: "sparkle" },
  { top: "14%", left: "24%", size: 6, delay: "0.7s", duration: "1.8s", type: "dot" },
  { top: "22%", left: "7%", size: 14, delay: "1.1s", duration: "2.6s", type: "sparkle" },
  { top: "10%", left: "84%", size: 18, delay: "0.3s", duration: "2.4s", type: "sparkle" },
  { top: "18%", left: "74%", size: 6, delay: "1.4s", duration: "1.7s", type: "dot" },
  { top: "26%", left: "90%", size: 15, delay: "0.8s", duration: "2.5s", type: "sparkle" },
  { top: "6%", left: "48%", size: 13, delay: "0.9s", duration: "2.1s", type: "sparkle" },
  { top: "12%", left: "60%", size: 6, delay: "0.2s", duration: "1.6s", type: "dot" },
  { top: "40%", left: "6%", size: 16, delay: "1.3s", duration: "2.7s", type: "sparkle" },
  { top: "56%", left: "10%", size: 7, delay: "0.5s", duration: "1.9s", type: "dot" },
  { top: "72%", left: "15%", size: 14, delay: "1.0s", duration: "2.8s", type: "sparkle" },
  { top: "38%", left: "94%", size: 16, delay: "0.9s", duration: "2.3s", type: "sparkle" },
  { top: "60%", left: "88%", size: 7, delay: "1.2s", duration: "1.8s", type: "dot" },
  { top: "75%", left: "84%", size: 14, delay: "0.4s", duration: "2.4s", type: "sparkle" },
  { top: "82%", left: "26%", size: 11, delay: "1.5s", duration: "2.2s", type: "sparkle" },
  { top: "85%", left: "70%", size: 13, delay: "0.3s", duration: "2.6s", type: "sparkle" },
  { top: "32%", left: "18%", size: 20, delay: "1.7s", duration: "3.1s", type: "sparkle" },
  { top: "34%", left: "80%", size: 18, delay: "1.0s", duration: "2.9s", type: "sparkle" },
  { top: "48%", left: "18%", size: 6, delay: "0.6s", duration: "1.5s", type: "dot" },
  { top: "51%", left: "82%", size: 7, delay: "1.3s", duration: "1.7s", type: "dot" },
  { top: "66%", left: "28%", size: 5, delay: "0.2s", duration: "2.0s", type: "dot" },
  { top: "68%", left: "72%", size: 6, delay: "0.8s", duration: "2.1s", type: "dot" },
  { top: "80%", left: "50%", size: 16, delay: "0.7s", duration: "2.7s", type: "sparkle" },
];

/**
 * Premium opening sequence:
 * Luxurious 3D purple shopping bag descends with golden/violet volumetric god-rays,
 * glowing cosmic dust, holographic store badges bursting out, and the Shopyx brand mark
 * crowning the climax.
 */
export default function BagIntro({ onDone }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      const { innerWidth, innerHeight } = window;
      const x = (e.clientX / innerWidth - 0.5) * 20;
      const y = (e.clientY / innerHeight - 0.5) * 15;
      setMousePos({ x, y });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t1 = window.setTimeout(() => setLeaving(true), reduce ? 200 : 4200);
    const t2 = window.setTimeout(
      () => {
        setGone(true);
        onDone();
      },
      reduce ? 500 : 5400,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone]);

  const handleSkip = (e) => {
    e.stopPropagation();
    setLeaving(true);
  };

  if (gone) return null;

  return (
    <div
      ref={containerRef}
      className={"intro-stage " + (leaving ? "is-leaving" : "")}
      aria-hidden="true"
      onClick={() => setLeaving(true)}
    >
      <span className="intro-vignette" />

      {/* Skip Button */}
      <button
        type="button"
        onClick={handleSkip}
        className="intro-skip-btn"
        title="Skip animation"
      >
        Skip ✕
      </button>

      {/* Twinkling starfield backdrop */}
      <div className="intro-stars">
        {STARS.map((star, idx) =>
          star.type === "dot" ? (
            <span
              key={idx}
              className="intro-star is-dot"
              style={{
                top: star.top,
                left: star.left,
                width: `${star.size}px`,
                height: `${star.size}px`,
                "--delay": star.delay,
                "--duration": star.duration,
              }}
            />
          ) : (
            <span
              key={idx}
              className="intro-star is-sparkle"
              style={{
                top: star.top,
                left: star.left,
                width: `${star.size}px`,
                height: `${star.size}px`,
                "--delay": star.delay,
                "--duration": star.duration,
              }}
            >
              <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
                <path d="M12 0L14.7 9.3L24 12L14.7 14.7L12 24L9.3 14.7L0 12L9.3 9.3L12 0Z" />
              </svg>
            </span>
          )
        )}
      </div>

      {/* Multi-layered background nebula glow */}
      <div
        className="intro-glow-primary"
        style={{
          transform: `translate(${mousePos.x * -0.5}px, ${mousePos.y * -0.5}px)`,
        }}
      />
      <div className="intro-glow-secondary" />

      <div
        className="intro-scene"
        style={{
          transform: `rotateY(${mousePos.x * 0.4}deg) rotateX(${-mousePos.y * 0.4}deg)`,
        }}
      >
        {/* Volumetric god rays */}
        <div className="intro-beam intro-beam-left" />
        <div className="intro-beam intro-beam-center" />
        <div className="intro-beam intro-beam-right" />

        {/* Shockwave halo */}
        <div className="intro-shockwave" />

        {/* 3D Shopping Bag */}
        <div className="intro-bag">
          {/* Handles */}
          <div className="intro-handle-back" />
          <div className="intro-handle-front" />

          {/* Bag Body Layers */}
          <div className="intro-bag-body">
            {/* Bag Interior Void / Glow */}
            <div className="intro-interior-glow" />

            {/* Logo Rising from within with radiant aura */}
            <div className="intro-mouth">
              <div className="intro-mark-wrapper">
                <img src="/logo-full.png" alt="Shopyx" className="intro-mark" />
                <div className="intro-mark-glow" />
              </div>
            </div>

            {/* Flying Store Badges emerging from the bag */}
            {STORE_BUBBLES.map((store, i) => (
              <div
                key={store.name}
                className="intro-store-badge"
                style={{
                  "--tx": `${store.x}px`,
                  "--ty": `${store.y}px`,
                  "--s": store.scale,
                  "--delay": `${store.delay}s`,
                }}
              >
                <img src={store.logo} alt={store.name} className="h-5 w-5 rounded-md" />
              </div>
            ))}

            {/* Bursting Sparks & Cosmic Dust */}
            <span className="intro-sparks">
              {SPARKS.map((sp, i) => (
                <i
                  key={i}
                  style={{
                    "--x": `${sp.x}rem`,
                    "--d": `${sp.d}s`,
                    "--s": `${sp.s}rem`,
                    "--color": sp.color,
                  }}
                />
              ))}
            </span>

            {/* Folding 3D Flaps with metallic foil edges */}
            <div className="intro-flap intro-flap-left">
              <span className="intro-flap-crease" />
            </div>
            <div className="intro-flap intro-flap-right">
              <span className="intro-flap-crease" />
            </div>

            {/* Specular light sweep across bag exterior */}
            <div className="intro-shine" />
            <div className="intro-rim-highlight" />
          </div>
        </div>

        {/* Animated Shimmer Tagline */}
        <div className="intro-tagline-container">
          <p className="intro-tagline">one search. every store.</p>
          <span className="intro-tagline-bar" />
        </div>
      </div>
    </div>
  );
}

