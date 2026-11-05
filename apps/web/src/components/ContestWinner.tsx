import { useMemo } from "react";
import { Trophy } from "@phosphor-icons/react";
import type { TakeoverChoice } from "@manyqueue/shared";
import { useReducedMotion } from "../hooks/useReducedMotion";

const GOLD = "#fbbf24";
const CONFETTI = [GOLD, "#f472b6", "#60a5fa", "#34d399", "#f87171", "#c4b5fd", "#ffffff"];
const PIECES = 72;

/** Deterministic pseudo-random in [0,1) so the confetti is the same on every render. */
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The song contest's big moment (TV pixels, 1920x1080): a slow spinning burst of light, a trophy and
 * "WINNER" slamming in, the winning song popping up large, a confetti shower, and the loser small on
 * the side with both percentages. Only transform and opacity are animated. With reduced motion it is
 * the same picture with nothing moving.
 */
export function ContestWinner({
  winner,
  loser,
  resultText,
}: {
  winner: TakeoverChoice;
  loser: TakeoverChoice | undefined;
  resultText?: string;
}) {
  const reduced = useReducedMotion();
  const anyVotes = (winner.percent ?? 0) + (loser?.percent ?? 0) > 0;

  const confetti = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        left: rand(i, 1) * 100,
        size: 14 + rand(i, 2) * 18,
        color: CONFETTI[i % CONFETTI.length],
        delay: 0.5 + rand(i, 3) * 1.6,
        duration: 3 + rand(i, 4) * 2.2,
        drift: (rand(i, 5) - 0.5) * 360,
        spin: 360 + rand(i, 6) * 720,
        round: i % 3 === 0,
      })),
    [],
  );

  const anim = (css: string) => (reduced ? undefined : css);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        zIndex: 5,
        background: "radial-gradient(ellipse at 50% 42%, rgb(var(--color-accent-800)) 0%, rgb(var(--color-bg)) 72%)",
        animation: anim("mq-cw-fade 350ms ease both"),
      }}
    >
      <style>{`
        @keyframes mq-cw-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mq-cw-spin { to { transform: translate(-50%, -50%) rotate(360deg) } }
        @keyframes mq-cw-slam { 0% { opacity: 0; transform: scale(3) } 55% { opacity: 1; transform: scale(0.92) } 75% { transform: scale(1.05) } 100% { opacity: 1; transform: scale(1) } }
        @keyframes mq-cw-drop { 0% { opacity: 0; transform: translateY(-160px) scale(0.6) rotate(-20deg) } 60% { opacity: 1; transform: translateY(12px) scale(1.1) rotate(6deg) } 100% { opacity: 1; transform: translateY(0) scale(1) rotate(0) } }
        @keyframes mq-cw-pop { 0% { opacity: 0; transform: scale(0.3) } 60% { opacity: 1; transform: scale(1.12) } 80% { transform: scale(0.97) } 100% { opacity: 1; transform: scale(1) } }
        @keyframes mq-cw-rise { from { opacity: 0; transform: translateY(40px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes mq-cw-ring { 0% { opacity: 0.9; transform: translate(-50%, -50%) scale(0.4) } 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.6) } }
        @keyframes mq-cw-glow { 0%, 100% { opacity: 0.75 } 50% { opacity: 1 } }
        @keyframes mq-cw-fall { 0% { opacity: 0; transform: translate3d(0, -80px, 0) rotate(0) } 8% { opacity: 1 } 100% { opacity: 1; transform: translate3d(var(--drift), 1240px, 0) rotate(var(--spin)) } }
      `}</style>

      {/* Slowly turning rays behind the winner */}
      <div
        className="absolute"
        style={{
          left: "50%",
          top: 470,
          width: 2400,
          height: 2400,
          transform: "translate(-50%, -50%)",
          background:
            "repeating-conic-gradient(from 0deg, rgb(251 191 36 / 0.20) 0deg 9deg, transparent 9deg 24deg)",
          WebkitMaskImage: "radial-gradient(closest-side, black 8%, transparent 70%)",
          maskImage: "radial-gradient(closest-side, black 8%, transparent 70%)",
          animation: anim("mq-cw-spin 26s linear infinite"),
        }}
      />

      {/* Trophy + WINNER */}
      <div className="absolute flex flex-col items-center" style={{ top: 96, left: 0, right: 0 }}>
        <div style={{ animation: anim("mq-cw-drop 700ms cubic-bezier(.2,.8,.3,1) 250ms both"), filter: `drop-shadow(0 0 28px ${GOLD})` }}>
          <Trophy size={112} weight="fill" color={GOLD} />
        </div>
        <p
          className="font-black uppercase"
          style={{
            marginTop: 4,
            fontSize: 92,
            letterSpacing: "0.32em",
            paddingLeft: "0.32em",
            color: GOLD,
            textShadow: `0 0 40px ${GOLD}99, 0 6px 0 rgb(0 0 0 / 0.35)`,
            animation: anim("mq-cw-slam 600ms cubic-bezier(.2,.9,.3,1) 550ms both"),
          }}
        >
          Winner
        </p>
      </div>

      {/* The winning song */}
      <div
        className="absolute flex flex-col items-center text-center"
        style={{ top: 345, left: 620, width: 680, animation: anim("mq-cw-pop 750ms cubic-bezier(.2,.8,.3,1) 800ms both") }}
      >
        <div className="relative" style={{ width: 360, height: 360 }}>
          {!reduced && (
            <div
              className="absolute rounded-full"
              style={{
                left: "50%",
                top: "50%",
                width: 360,
                height: 360,
                border: `6px solid ${GOLD}`,
                animation: "mq-cw-ring 1400ms ease-out 1100ms both",
              }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: 22,
              boxShadow: `0 0 0 6px ${GOLD}, 0 0 90px 10px ${GOLD}88`,
              animation: anim("mq-cw-glow 2.4s ease-in-out 1.6s infinite"),
            }}
          />
          {winner.artUrl ? (
            <img src={winner.artUrl} alt="" className="relative" style={{ width: 360, height: 360, borderRadius: 22 }} />
          ) : (
            <div className="relative bg-gradient-to-br from-accent-700 to-accent-900" style={{ width: 360, height: 360, borderRadius: 22 }} />
          )}
        </div>
        <p className="w-full truncate font-bold text-accent-100" style={{ marginTop: 24, fontSize: 60, lineHeight: 1.1, animation: anim("mq-cw-rise 500ms ease 1300ms both") }}>
          {winner.label}
        </p>
        {winner.sublabel && (
          <p className="w-full truncate text-accent-200" style={{ marginTop: 6, fontSize: 32, animation: anim("mq-cw-rise 500ms ease 1400ms both") }}>
            {winner.sublabel}
          </p>
        )}
        {winner.byline && (
          <p className="w-full truncate text-accent-300" style={{ marginTop: 4, fontSize: 28, animation: anim("mq-cw-rise 500ms ease 1500ms both") }}>
            Picked by {winner.byline}
          </p>
        )}
      </div>

      {/* Percentages: big for the winner, small for the other song */}
      {anyVotes && (
        <p
          className="absolute font-black tabular-nums"
          style={{ top: 520, left: 96, width: 500, textAlign: "center", fontSize: 150, color: GOLD, lineHeight: 1, animation: anim("mq-cw-pop 650ms cubic-bezier(.2,.8,.3,1) 1500ms both") }}
        >
          {Math.round(winner.percent ?? 0)}%
          <span className="block font-medium uppercase text-accent-200" style={{ fontSize: 28, letterSpacing: "0.3em", marginTop: 8 }}>
            of the vote
          </span>
        </p>
      )}
      {loser && (
        <div
          className="absolute flex flex-col items-center text-center"
          style={{ top: 470, right: 96, width: 360, opacity: 0.55, animation: anim("mq-cw-rise 600ms ease 1600ms both") }}
        >
          {loser.artUrl ? (
            <img src={loser.artUrl} alt="" style={{ width: 220, height: 220, borderRadius: 14, filter: "grayscale(0.6)" }} />
          ) : (
            <div className="bg-accent-800" style={{ width: 220, height: 220, borderRadius: 14 }} />
          )}
          <p className="w-full truncate text-accent-100" style={{ marginTop: 16, fontSize: 30 }}>
            {loser.label}
          </p>
          {anyVotes && (
            <p className="tabular-nums text-accent-200" style={{ fontSize: 36 }}>
              {Math.round(loser.percent ?? 0)}%
            </p>
          )}
        </div>
      )}

      {resultText && (
        <p
          className="absolute text-center font-medium text-accent-100"
          style={{ left: 0, right: 0, bottom: 26, fontSize: 36, animation: anim("mq-cw-rise 600ms ease 1900ms both") }}
        >
          {resultText}
        </p>
      )}

      {/* Confetti */}
      {!reduced &&
        confetti.map((c, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              top: 0,
              left: `${c.left}%`,
              width: c.size,
              height: c.round ? c.size : c.size * 0.5,
              borderRadius: c.round ? "50%" : 3,
              background: c.color,
              opacity: 0,
              // @ts-expect-error CSS custom properties for the keyframes
              "--drift": `${c.drift}px`,
              "--spin": `${c.spin}deg`,
              animation: `mq-cw-fall ${c.duration}s linear ${c.delay}s both`,
            }}
          />
        ))}
    </div>
  );
}
