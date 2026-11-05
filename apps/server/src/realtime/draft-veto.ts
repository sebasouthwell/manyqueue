import { db, type DB } from "../db/client.js";
import { getRoomSettings } from "../db/settings.js";
import { getOnDeckItems } from "../db/queue.js";
import type { Room } from "../db/rooms.js";

/**
 * Auto + host veto (the Rotation-mode design §9). Rotation drafts at the last moment (the handoff), so the
 * veto window is the 15s just before it: the host sees "Drafting now…" with the song rotation is about
 * to pick, and can Swap it (Draft now anything else) or Skip it (rotation moves on to the next guest for
 * this slot; the skipped guest keeps their turn and their song stays at the top of their queue).
 *
 * All of it is in memory and per slot: a restart or the next song simply forgets it, which at worst
 * drafts the song the host meant to skip.
 */
export const VETO_WINDOW_MS = 15_000;
/** Stand-in "guest" id for skipping a mystery slot: the pool sits this one out. */
export const POOL_KEY = "__pool";

interface SlotState {
  playingItemId: string;
  commitsAt: number | null;
  skipped: Set<string>;
}

const slots = new Map<string, SlotState>();
const lastSentCommitsAt = new Map<string, number | null>();

export function isAutoVeto(roomId: string, database: DB = db): boolean {
  const s = getRoomSettings(roomId, database);
  return s.mode === "rotation" && s.draftingStyle === "auto_veto" && s.nextSongMethod === "rotation";
}

/** Guests (and POOL_KEY) the host skipped for the slot being drafted now. */
export function skippedForSlot(roomId: string): ReadonlySet<string> {
  return slots.get(roomId)?.skipped ?? new Set();
}

/** When the pending draft commits (server ms), or null when no veto window is open. */
export function vetoCommitsAt(roomId: string): number | null {
  return slots.get(roomId)?.commitsAt ?? null;
}

export interface VetoTickInput {
  playingItemId: string | null;
  durationMs: number;
  remainingMs: number;
  /** How long before the end the draft commits (the handoff plus its lead). */
  commitLeadMs: number;
}

/** Opens and closes the window as the song plays. True when the host board needs a refresh. */
export function vetoTick(room: Room, input: VetoTickInput, database: DB = db, now = Date.now()): boolean {
  const { playingItemId, durationMs, remainingMs, commitLeadMs } = input;
  let slot = slots.get(room.id);
  if (!playingItemId || durationMs <= 0 || !isAutoVeto(room.id, database)) {
    slots.delete(room.id);
    return changed(room.id, null);
  }
  if (!slot || slot.playingItemId !== playingItemId) {
    slot = { playingItemId, commitsAt: null, skipped: new Set() };
    slots.set(room.id, slot);
  }
  const untilCommit = remainingMs - commitLeadMs;
  // Nothing to veto once the next song is on deck (drafted, or the host already picked one).
  const nextOnDeck = getOnDeckItems(room.id, database).some((o) => o.status !== "playing");
  if (nextOnDeck) slot.skipped.clear(); // the slot is filled: skips were for it alone
  const open = !nextOnDeck && untilCommit > 0 && untilCommit <= VETO_WINDOW_MS;
  slot.commitsAt = open ? now + untilCommit : null;
  return changed(room.id, slot.commitsAt);
}

/** Broadcast on open and close, and when the countdown drifts (a seek) by more than 3s. */
function changed(roomId: string, commitsAt: number | null): boolean {
  const last = lastSentCommitsAt.get(roomId) ?? null;
  const differs = (last === null) !== (commitsAt === null) || (last !== null && commitsAt !== null && Math.abs(last - commitsAt) > 3000);
  if (differs) lastSentCommitsAt.set(roomId, commitsAt);
  return differs;
}

/** Skip the pending draft's guest (or the pool) for this slot only. False when no window is open. */
export function skipPendingDraft(roomId: string, guestIdOrPool: string): boolean {
  const slot = slots.get(roomId);
  if (!slot || slot.commitsAt === null) return false;
  slot.skipped.add(guestIdOrPool);
  return true;
}

/** Tests only. */
export function resetVetoState(): void {
  slots.clear();
  lastSentCommitsAt.clear();
}
