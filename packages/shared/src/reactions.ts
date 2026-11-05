/** Fire is always the first button and never changes. */
export const FIRE_REACTION = "🔥";

/** What a guest starts with: fire plus three they can swap in the Me tab. */
export const DEFAULT_REACTIONS = ["🔥", "💀", "💃", "😭"] as const;

/** The emoji a guest may choose from (fire is fixed, so it isn't offered for
 * the other three slots). The server only accepts these. */
export const REACTION_PALETTE = [
  "🔥", "💀", "💃", "😭", "🎉", "❤️", "😂", "🙌", "👏", "🤯", "😍", "🥳",
  "🕺", "🎶", "🍻", "💯", "✨", "😎", "🤘", "👀", "🤩", "🥹", "🫶", "🙈",
] as const;

export type ReactionEmoji = (typeof REACTION_PALETTE)[number];
export const REACTION_SLOTS = 4;

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && (REACTION_PALETTE as readonly string[]).includes(value);
}

/** Turns whatever was saved (or nothing) into a valid set of four: fire first,
 * then three distinct palette emoji; anything wrong falls back to the default
 * for that slot. */
export function sanitizeReactionSet(saved: unknown): ReactionEmoji[] {
  const input = Array.isArray(saved) ? saved : [];
  const out: ReactionEmoji[] = [FIRE_REACTION];
  for (let slot = 1; slot < REACTION_SLOTS; slot++) {
    const pick = input[slot];
    const usable = isReactionEmoji(pick) && pick !== FIRE_REACTION && !out.includes(pick);
    if (usable) {
      out.push(pick);
      continue;
    }
    const fallback = DEFAULT_REACTIONS.find((d) => !out.includes(d)) ?? REACTION_PALETTE.find((p) => !out.includes(p))!;
    out.push(fallback);
  }
  return out;
}

/** Minimum gap between one guest's reactions (5 per second) — enforced by the server, mirrored on the phone. */
export const REACTION_COOLDOWN_MS = 200;

/** ms until this guest may react again; 0 means now. */
export function reactionCooldownLeft(lastAt: number | undefined, now: number): number {
  if (lastAt === undefined) return 0;
  return Math.max(0, lastAt + REACTION_COOLDOWN_MS - now);
}

/** Phone → server. The server knows who sent it from the socket. */
export interface ReactionSendPayload {
  emoji: ReactionEmoji;
}

/** Server → TV only; phones never see each other's reactions. */
export interface ReactionPayload {
  emoji: ReactionEmoji;
  guestId: string;
}

/** The TV keeps 30 recycled floating nodes. */
export const REACTION_POOL_SIZE = 30;

/** Bursts are cut from the overflow at most this often. */
export const REACTION_BURST_FLUSH_MS = 300;

export interface ReactionPoolState {
  /** Floating nodes currently in flight. */
  active: number;
  /** Reactions that arrived while the pool was full, waiting to become a burst. */
  overflow: Partial<Record<ReactionEmoji, number>>;
}

export const initialReactionPool: ReactionPoolState = { active: 0, overflow: {} };

/** A free node floats the emoji; a full pool folds it into the overflow. */
export function poolOnReaction(
  state: ReactionPoolState,
  emoji: ReactionEmoji,
  capacity: number = REACTION_POOL_SIZE,
): { state: ReactionPoolState; float: boolean } {
  if (state.active < capacity) {
    return { state: { ...state, active: state.active + 1 }, float: true };
  }
  return {
    state: { ...state, overflow: { ...state.overflow, [emoji]: (state.overflow[emoji] ?? 0) + 1 } },
    float: false,
  };
}

export function poolOnFloatDone(state: ReactionPoolState): ReactionPoolState {
  return { ...state, active: Math.max(0, state.active - 1) };
}

/** Turns whatever overflowed into bursts ("🔥 ×12"), one per emoji. */
export function poolFlush(state: ReactionPoolState): {
  state: ReactionPoolState;
  bursts: { emoji: ReactionEmoji; count: number }[];
} {
  const bursts = (Object.entries(state.overflow) as [ReactionEmoji, number][])
    .filter(([, count]) => count > 0)
    .map(([emoji, count]) => ({ emoji, count }));
  return { state: { ...state, overflow: {} }, bursts };
}

/** "🔥 18": the reaction a song got most, for a queue/history row. */
export function topReaction(reactions: readonly { emoji: string; count: number }[]): { emoji: string; count: number } | null {
  let best: { emoji: string; count: number } | null = null;
  for (const r of reactions) if (r.count > 0 && (!best || r.count > best.count)) best = r;
  return best;
}
