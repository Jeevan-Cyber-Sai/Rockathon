import { useEffect, useState } from "react";

const SPARKS = Array.from({ length: 14 }, (_, i) => i);

const STARS = [
  { top: "10%", left: "12%", size: 15, delay: "0.1s", duration: "2.2s", type: "sparkle" },
  { top: "16%", left: "26%", size: 7, delay: "0.7s", duration: "1.8s", type: "dot" },
  { top: "24%", left: "8%", size: 12, delay: "1.1s", duration: "2.6s", type: "sparkle" },
  { top: "12%", left: "82%", size: 18, delay: "0.3s", duration: "2.4s", type: "sparkle" },
  { top: "20%", left: "72%", size: 6, delay: "1.4s", duration: "1.7s", type: "dot" },
  { top: "28%", left: "88%", size: 14, delay: "0.8s", duration: "2.5s", type: "sparkle" },
  { top: "7%", left: "46%", size: 13, delay: "0.9s", duration: "2.1s", type: "sparkle" },
  { top: "14%", left: "58%", size: 6, delay: "0.2s", duration: "1.6s", type: "dot" },
  { top: "42%", left: "7%", size: 16, delay: "1.3s", duration: "2.7s", type: "sparkle" },
  { top: "58%", left: "11%", size: 8, delay: "0.5s", duration: "1.9s", type: "dot" },
  { top: "74%", left: "16%", size: 14, delay: "1.0s", duration: "2.8s", type: "sparkle" },
  { top: "40%", left: "93%", size: 15, delay: "0.9s", duration: "2.3s", type: "sparkle" },
  { top: "62%", left: "86%", size: 7, delay: "1.2s", duration: "1.8s", type: "dot" },
  { top: "76%", left: "82%", size: 13, delay: "0.4s", duration: "2.4s", type: "sparkle" },
  { top: "84%", left: "28%", size: 11, delay: "1.5s", duration: "2.2s", type: "sparkle" },
  { top: "86%", left: "68%", size: 12, delay: "0.3s", duration: "2.6s", type: "sparkle" },
  { top: "34%", left: "20%", size: 20, delay: "1.7s", duration: "3.1s", type: "sparkle" },
  { top: "36%", left: "78%", size: 17, delay: "1.0s", duration: "2.9s", type: "sparkle" },
  { top: "50%", left: "19%", size: 6, delay: "0.6s", duration: "1.5s", type: "dot" },
  { top: "53%", left: "80%", size: 7, delay: "1.3s", duration: "1.7s", type: "dot" },
  { top: "68%", left: "30%", size: 5, delay: "0.2s", duration: "2.0s", type: "dot" },
  { top: "70%", left: "70%", size: 6, delay: "0.8s", duration: "2.1s", type: "dot" },
  { top: "9%", left: "64%", size: 12, delay: "1.6s", duration: "2.5s", type: "sparkle" },
  { top: "26%", left: "36%", size: 14, delay: "0.4s", duration: "2.2s", type: "sparkle" },
  { top: "25%", left: "64%", size: 13, delay: "1.2s", duration: "2.4s", type: "sparkle" },
  { top: "82%", left: "48%", size: 15, delay: "0.7s", duration: "2.7s", type: "sparkle" },
];

/**
 * Opening sequence: a purple shopping bag settles in, its flaps fold open,
 * a beam of light spills out with sparks, twinkling stars shimmer in the background,
 * the brand rises from inside, then the whole scene lifts away into the page.
 */
export default function BagIntro({ onDone }) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t1 = window.setTimeout(() => setLeaving(true), reduce ? 200 : 3800);
    const t2 = window.setTimeout(
      () => {
        setGone(true);
        onDone();
      },
      reduce ? 500 : 5100,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone]);

  if (gone) return null;

  return (
    <div
      className={"intro-stage " + (leaving ? "is-leaving" : "")}
      aria-hidden="true"
      onClick={() => setLeaving(true)}
    >
      <span className="intro-vignette" />

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
              <svg
                viewBox="0 0 24 24"
                className="w-full h-full"
                fill="currentColor"
              >
                <path d="M12 0L14.7 9.3L24 12L14.7 14.7L12 24L9.3 14.7L0 12L9.3 9.3L12 0Z" />
              </svg>
            </span>
          )
        )}
      </div>

      <div className="intro-scene">
        <div className="intro-glow" />
        <div className="intro-beam" />

        <div className="intro-bag">
          <span className="intro-handle" />
          <span className="intro-bag-back" />

          <span className="intro-mouth">
            <img src="/logo-full.png" alt="" className="intro-mark" />
          </span>

          <span className="intro-sparks">
            {SPARKS.map((i) => (
              <i
                key={i}
                style={{
                  "--x": `${(i % 7) * 1.6 - 4.8}rem`,
                  "--d": `${1.05 + (i % 5) * 0.14}s`,
                  "--s": `${0.35 + (i % 4) * 0.22}rem`,
                }}
              />
            ))}
          </span>

          <span className="intro-flap intro-flap-left" />
          <span className="intro-flap intro-flap-right" />
          <span className="intro-shine" />
        </div>

        <p className="intro-tagline">one search. every store.</p>
      </div>
    </div>
  );
}
