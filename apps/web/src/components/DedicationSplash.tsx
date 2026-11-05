import { useEffect, useMemo, useState } from "react";
import { Heart, MusicNotes } from "@phosphor-icons/react";
import { DEDICATION_SPLASH_MS } from "@manyqueue/shared";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  text: string;
  trackName: string | null;
  artistName: string | null;
  onDone: () => void;
}

function fontSizeFor(text: string): number {
  const n = Array.from(text).length;
  if (n <= 14) return 190;
  if (n <= 28) return 140;
  if (n <= 44) return 108;
  return 88;
}

/** The big moment when a dedicated song first starts: the words pop in over a
 * glowing stage with hearts drifting up, hold, then fade out and hand over to
 * the small line. Transform/opacity only. With reduced motion it's a plain
 * fade with no drifting hearts. Sits under the header and QR like a takeover. */
export function DedicationSplash({ text, trackName, artistName, onDone }: Props) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    const out = setTimeout(() => setPhase("out"), DEDICATION_SPLASH_MS - 600);
    const done = setTimeout(onDone, DEDICATION_SPLASH_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hearts = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        left: 60 + ((i * 113) % 1800),
        size: 44 + ((i * 29) % 56),
        delay: ((i * 0.37) % 3.2).toFixed(2),
        duration: (4.2 + ((i * 0.53) % 2.6)).toFixed(2),
        dx: ((i % 2 ? 1 : -1) * (20 + ((i * 17) % 90))).toString(),
      })),
    [],
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-gradient-to-br from-section to-bg"
      style={{ zIndex: 30, opacity: phase === "in" ? 1 : 0, transition: "opacity 600ms ease" }}
    >
      {!reduced && (
        <>
          <div
            className="absolute rounded-full"
            style={{
              left: 360, top: 120, width: 1200, height: 840,
              background: "radial-gradient(closest-side, rgb(var(--color-accent) / 0.45), transparent)",
              animation: "mq-glow 3s ease-in-out infinite",
            }}
          />
          {hearts.map((h, i) => (
            <Heart
              key={i}
              weight="fill"
              size={h.size}
              className="absolute text-accent-300"
              style={{
                left: h.left,
                bottom: -120,
                ["--dx" as string]: `${h.dx}px`,
                animation: `mq-float-up ${h.duration}s ${h.delay}s ease-out infinite`,
                willChange: "transform, opacity",
              }}
            />
          ))}
        </>
      )}

      <div className="absolute inset-x-0 flex flex-col items-center text-center" style={{ top: 230, padding: "0 140px" }}>
        <p
          className="font-semibold uppercase text-accent-300"
          style={{ fontSize: 40, letterSpacing: "0.5em", animation: reduced ? undefined : "mq-pop-in 700ms ease-out both" }}
        >
          A dedication
        </p>
        <p
          className="font-bold leading-[1.05]"
          style={{
            marginTop: 40,
            fontSize: fontSizeFor(text),
            overflowWrap: "anywhere",
            backgroundImage:
              "linear-gradient(90deg, rgb(var(--color-accent-100)), rgb(var(--color-accent-300)), rgb(var(--color-accent-100)))",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            animation: reduced ? undefined : "mq-pop-in 900ms 250ms cubic-bezier(0.34, 1.56, 0.64, 1) both, mq-shimmer 4s linear infinite",
          }}
        >
          {text}
        </p>
        {trackName && (
          <p
            className="flex items-center gap-4 text-accent-200"
            style={{ marginTop: 56, fontSize: 40, animation: reduced ? undefined : "mq-pop-in 700ms 900ms ease-out both" }}
          >
            <MusicNotes size={44} weight="fill" className="text-accent-300" />
            {trackName}
            {artistName ? ` · ${artistName}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
