import { useEffect, useState } from "react";
import logo from "@/assets/shopyx-logo.png.asset.json";

const SPARKS = Array.from({ length: 14 }, (_, i) => i);

/**
 * Opening sequence: a purple shopping bag settles in, its flaps fold open,
 * a beam of light spills out with sparks, the brand rises from inside,
 * then the whole scene lifts away into the page.
 */
export function BagIntro({ onDone }: { onDone: () => void }) {
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
      className={`intro-stage ${leaving ? "is-leaving" : ""}`}
      aria-hidden="true"
      onClick={() => setLeaving(true)}
    >
      <span className="intro-vignette" />
      <div className="intro-scene">
        <div className="intro-glow" />
        <div className="intro-beam" />

        <div className="intro-bag">
          <span className="intro-handle" />
          <span className="intro-bag-back" />

          <span className="intro-mouth">
            <img src={logo.url} alt="" className="intro-mark" />
          </span>

          <span className="intro-sparks">
            {SPARKS.map((i) => (
              <i
                key={i}
                style={
                  {
                    "--x": `${(i % 7) * 1.6 - 4.8}rem`,
                    "--d": `${1.05 + (i % 5) * 0.14}s`,
                    "--s": `${0.35 + (i % 4) * 0.22}rem`,
                  } as React.CSSProperties
                }
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
