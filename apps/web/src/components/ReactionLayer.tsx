import { useEffect, useRef, useState } from "react";
import {
  REACTION_BURST_FLUSH_MS,
  REACTION_POOL_SIZE,
  initialReactionPool,
  poolFlush,
  poolOnFloatDone,
  poolOnReaction,
  type ReactionEmoji,
  type ReactionPayload,
} from "@manyqueue/shared";
import { reactionBus } from "../lib/reactionBus";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { twemojiUrl } from "./Emoji";

const AREA_LEFT = 1152; // right 40% of the 1920 stage
const AREA_WIDTH = 768;
const NODE_SIZE = 64;
const RISE_PX = 520;
const FLOAT_MS = 3200;
const SWAY_PX = 24;
const BURST_MS = 1200;
const BURST_SLOTS = 6;

interface Props {
  /** True while a takeover owns the screen: reactions stop and are dropped. */
  hidden: boolean;
  /** Changes with the song, so the reduced-motion badge counts per song. */
  trackKey: string | null;
}

/**
 * The TV's floating reactions: a fixed pool of 30 recycled <img> nodes in the
 * right 40%, animated with WAAPI on transform + opacity only. When the pool is
 * full, further reactions fold into a burst ("🔥 ×12") instead of more nodes.
 * Everything runs off refs — no React state per reaction — so a flood can't
 * cause renders. With reduced motion there's no motion at all, just a per-song
 * count badge.
 */
export function ReactionLayer({ hidden, trackKey }: Props) {
  const reduced = useReducedMotion();
  const nodes = useRef<(HTMLImageElement | null)[]>([]);
  const busy = useRef<boolean[]>(Array(REACTION_POOL_SIZE).fill(false));
  const animations = useRef<(Animation | null)[]>(Array(REACTION_POOL_SIZE).fill(null));
  const burstNodes = useRef<(HTMLDivElement | null)[]>([]);
  // Which emoji a burst slot is currently showing (a slot is reused once its animation ends).
  const burstEmoji = useRef<(ReactionEmoji | null)[]>(Array(BURST_SLOTS).fill(null));
  const burstCounts = useRef<number[]>(Array(BURST_SLOTS).fill(0));
  const pool = useRef(initialReactionPool);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const [badge, setBadge] = useState<Partial<Record<ReactionEmoji, number>>>({});

  useEffect(() => setBadge({}), [trackKey]);

  function float(emoji: ReactionEmoji) {
    const idx = busy.current.indexOf(false);
    const el = nodes.current[idx];
    if (idx === -1 || !el) return;
    busy.current[idx] = true;
    el.src = twemojiUrl(emoji);
    const x0 = Math.random() * (AREA_WIDTH - NODE_SIZE);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const anim = el.animate(
      [
        { transform: `translate3d(${x0}px, 0, 0)`, opacity: 0 },
        { transform: `translate3d(${x0 + dir * SWAY_PX}px, ${-RISE_PX * 0.2}px, 0)`, opacity: 1, offset: 0.12 },
        { transform: `translate3d(${x0 - dir * SWAY_PX}px, ${-RISE_PX * 0.55}px, 0)`, opacity: 1, offset: 0.55 },
        { transform: `translate3d(${x0 + dir * (SWAY_PX / 2)}px, ${-RISE_PX}px, 0)`, opacity: 0 },
      ],
      { duration: FLOAT_MS, easing: "ease-out" },
    );
    animations.current[idx] = anim;
    anim.onfinish = () => {
      busy.current[idx] = false;
      animations.current[idx] = null;
      el.style.opacity = "0";
      pool.current = poolOnFloatDone(pool.current);
    };
    el.style.opacity = "";
  }

  function burst(emoji: ReactionEmoji, count: number) {
    // Same emoji already bursting → add to it; otherwise take a free slot (or the first).
    let idx = burstEmoji.current.findIndex((e, i) => e === emoji && burstNodes.current[i]?.getAnimations().length);
    if (idx === -1) idx = burstNodes.current.findIndex((el) => el && el.getAnimations().length === 0);
    if (idx === -1) idx = 0;
    const el = burstNodes.current[idx];
    if (!el) return;
    const sameAsBefore = burstEmoji.current[idx] === emoji && el.getAnimations().length > 0;
    const total = (sameAsBefore ? burstCounts.current[idx] : 0) + count;
    burstEmoji.current[idx] = emoji;
    burstCounts.current[idx] = total;
    const img = el.querySelector("img");
    if (img) img.src = twemojiUrl(emoji);
    const label = el.querySelector("span");
    if (label) label.textContent = `×${total}`;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: "scale(0.6)", opacity: 0 },
        { transform: "scale(1.1)", opacity: 1, offset: 0.25 },
        { transform: "scale(1)", opacity: 1, offset: 0.7 },
        { transform: "translate3d(0, -40px, 0) scale(1)", opacity: 0 },
      ],
      { duration: BURST_MS, easing: "ease-out" },
    ).onfinish = () => {
      burstCounts.current[idx] = 0;
      burstEmoji.current[idx] = null;
    };
  }

  function reset() {
    for (const a of animations.current) a?.cancel();
    animations.current.fill(null);
    busy.current.fill(false);
    for (const el of burstNodes.current) el?.getAnimations().forEach((a) => a.cancel());
    burstCounts.current.fill(0);
    burstEmoji.current.fill(null);
    pool.current = initialReactionPool;
  }

  useEffect(() => {
    if (hidden) reset();
  }, [hidden]);

  useEffect(() => {
    function onReaction({ emoji }: ReactionPayload) {
      if (hiddenRef.current) return;
      if (reduced) {
        setBadge((prev) => ({ ...prev, [emoji]: (prev[emoji] ?? 0) + 1 }));
        return;
      }
      const next = poolOnReaction(pool.current, emoji);
      pool.current = next.state;
      if (next.float) float(emoji);
    }
    const off = reactionBus.subscribe(onReaction);
    const flush = setInterval(() => {
      if (hiddenRef.current || reduced) return;
      const { state, bursts: due } = poolFlush(pool.current);
      if (due.length === 0) return;
      pool.current = state;
      for (const b of due) burst(b.emoji, b.count);
    }, REACTION_BURST_FLUSH_MS);
    return () => {
      off();
      clearInterval(flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  if (reduced) {
    const entries = (Object.keys(badge) as ReactionEmoji[]).filter((e) => (badge[e] ?? 0) > 0);
    if (hidden || entries.length === 0) return null;
    return (
      <div className="absolute flex gap-3" style={{ left: 96, top: 640, zIndex: 20 }}>
        {entries.map((e) => (
          <span
            key={e}
            className="flex items-center gap-2 rounded-full bg-accent-800 px-4 py-2 text-accent-100"
            style={{ fontSize: 28 }}
          >
            <img src={twemojiUrl(e)} alt={e} style={{ width: 32, height: 32 }} />
            <span className="tabular-nums">{badge[e]}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: AREA_LEFT, top: 0, width: AREA_WIDTH, height: 1080, zIndex: 20, display: hidden ? "none" : "block" }}
    >
      {Array.from({ length: REACTION_POOL_SIZE }, (_, i) => (
        <img
          key={i}
          ref={(el) => {
            nodes.current[i] = el;
          }}
          alt=""
          draggable={false}
          style={{ position: "absolute", left: 0, bottom: 90, width: NODE_SIZE, height: NODE_SIZE, opacity: 0, willChange: "transform, opacity" }}
        />
      ))}
      {Array.from({ length: BURST_SLOTS }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            burstNodes.current[i] = el;
          }}
          className="absolute flex items-center gap-3 text-accent-100"
          style={{ left: 120 + (i % 2) * 300, top: 240 + Math.floor(i / 2) * 190, opacity: 0, fontSize: 96, fontWeight: 700, willChange: "transform, opacity" }}
        >
          <img alt="" style={{ width: 96, height: 96 }} />
          <span className="tabular-nums" />
        </div>
      ))}
    </div>
  );
}
