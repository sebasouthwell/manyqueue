import { useEffect, useRef, useState } from "react";
import {
  REACTION_COOLDOWN_MS,
  SOCKET_EVENTS,
  reactionCooldownLeft,
  type ReactionEmoji,
} from "@manyqueue/shared";
import { getSocket } from "../socket";
import { Emoji } from "./Emoji";
import { useRoomStore } from "../store/roomStore";

const SIZE = 56;
const RING = 2.5;
const RADIUS = (SIZE - RING) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Four reaction buttons. They fire on pointerdown (no waiting for the finger
 * to lift), press to 0.92, buzz where supported, and share one short cooldown (5 per second)
 * cooldown: while it runs every button dims to 45% and shows a filling ring,
 * and taps are ignored without any error. The server enforces the same limit. */
export function ReactionBar() {
  const reactionSet = useRoomStore((s) => s.reactionSet);
  const lastAt = useRef<number | undefined>(undefined);
  const [cooldownKey, setCooldownKey] = useState(0);
  const [cooling, setCooling] = useState(false);
  const [pressed, setPressed] = useState<ReactionEmoji | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function react(emoji: ReactionEmoji) {
    const now = Date.now();
    if (reactionCooldownLeft(lastAt.current, now) > 0) return;
    lastAt.current = now;
    getSocket().emit(SOCKET_EVENTS.REACTION_SEND, { emoji });
    navigator.vibrate?.(10);

    setPressed(emoji);
    setCooling(true);
    setCooldownKey((k) => k + 1);
    timers.current.push(
      setTimeout(() => setPressed(null), 120),
      setTimeout(() => setCooling(false), REACTION_COOLDOWN_MS),
    );
  }

  return (
    <div className="flex w-full justify-between" role="group" aria-label="Reactions">
      <style>{`@keyframes mq-ring { from { stroke-dashoffset: ${CIRCUMFERENCE}; } to { stroke-dashoffset: 0; } }`}</style>
      {reactionSet.map((emoji) => (
        <button
          key={emoji}
          onPointerDown={(e) => {
            e.preventDefault();
            react(emoji);
          }}
          onClick={(e) => {
            // Keyboard activation (Enter/Space); a real tap already fired on
            // pointerdown and is inside the cooldown here.
            if (e.detail === 0) react(emoji);
          }}
          aria-label={`React ${emoji}`}
          aria-disabled={cooling}
          className="relative grid place-items-center rounded-full bg-section"
          style={{
            width: SIZE,
            height: SIZE,
            opacity: cooling ? 0.45 : 1,
            transform: pressed === emoji ? "scale(0.92)" : "scale(1)",
            transition: "transform 90ms ease, opacity 120ms ease",
            touchAction: "manipulation",
            userSelect: "none",
          }}
        >
          <Emoji value={emoji} size={28} />
          {cooling && (
            <svg
              key={cooldownKey}
              width={SIZE}
              height={SIZE}
              className="pointer-events-none absolute inset-0 -rotate-90"
              aria-hidden="true"
            >
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="rgb(var(--color-accent-300))"
                strokeWidth={RING}
                strokeDasharray={CIRCUMFERENCE}
                style={{ animation: `mq-ring ${REACTION_COOLDOWN_MS}ms linear forwards` }}
              />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
