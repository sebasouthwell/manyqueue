import type { Server } from "socket.io";
import { SOCKET_EVENTS, computeLabels, type LabelResult, type ToastPayload } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { getGuestById } from "../db/guests.js";
import { getCachedGenres } from "../db/genres.js";
import { artistsForTasting } from "../db/taste.js";
import { buildLabelStats, listEarnedLabels, saveEarnedLabel } from "../db/label-stats.js";
import { emitToGuest, emitToTv } from "./socket-server.js";

/** At most this many labels are announced per check, so one big moment can't flood the TV; the rest follow next song. */
const MAX_ANNOUNCED_PER_CHECK = 3;

/** Genre tags come from the cache only: labels never make an AI call. */
function cachedGenres(roomId: string) {
  return getCachedGenres([...artistsForTasting(roomId).keys()]);
}

/**
 * Checks every guest against the label rules and announces newly earned ones: a small toast on the TV and a
 * bigger one on the guest's own phone. Called after each finished song and at the end of the night.
 */
export function evaluateLabels(io: Server, room: Room): void {
  const stats = buildLabelStats(room.id, cachedGenres(room.id));
  let announced = 0;
  for (const [guestId, s] of stats) {
    if (announced >= MAX_ANNOUNCED_PER_CHECK) break;
    const guest = getGuestById(guestId);
    if (!guest || guest.kickedAt) continue;
    for (const label of computeLabels(s).earned) {
      if (announced >= MAX_ANNOUNCED_PER_CHECK) break;
      if (!saveEarnedLabel(room.id, guestId, label)) continue; // already had it
      announced++;
      const tv: ToastPayload = { id: crypto.randomUUID(), message: `${guest.nickname} earned ${label.name}`, emoji: label.emoji };
      emitToTv(io, room.code, SOCKET_EVENTS.TOAST, tv);
      const mine: ToastPayload = { id: crypto.randomUUID(), message: `You earned ${label.name}!`, emoji: label.emoji, big: true, guestVisible: true };
      emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOAST, mine);
    }
  }
}

/** What one guest has earned, and how far along the closest others are (for the Me tab). */
export function guestLabels(room: Room, guestId: string): { earned: { key: string; emoji: string; name: string }[]; progress: LabelResult["progress"] } {
  const earned = listEarnedLabels(room.id).filter((l) => l.guestId === guestId);
  const stats = buildLabelStats(room.id, cachedGenres(room.id)).get(guestId);
  const have = new Set(earned.map((l) => l.key));
  const progress = stats ? computeLabels(stats).progress.filter((l) => !have.has(l.key)).slice(0, 3) : [];
  return { earned: earned.map((l) => ({ key: l.key, emoji: l.emoji, name: l.name })), progress };
}
