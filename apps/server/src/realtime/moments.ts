import type { Server } from "socket.io";
import { SOCKET_EVENTS, DEDICATION_TV_MS, type Moment, type MomentEndPayload, type TakeoverPayload } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { emitToTv, setTvJoinHook, setVolumeProvider } from "./socket-server.js";
import { getRoomVolume } from "./volume.js";
import { getPlayingItem, type QueueItem } from "../db/queue.js";
import { getRoomByCode } from "../db/rooms.js";

/**
 * Sends a moment to the TV, which owns the queueing (priority, min_ms, until —
 * see reduceMoments). The server only says what happened; it never needs to
 * know what's currently on screen.
 */
export function showMoment(io: Server, room: Room, moment: Moment): void {
  emitToTv(io, room.code, SOCKET_EVENTS.MOMENT_SHOW, moment);
}

export function endMoment(io: Server, room: Room, id: string): void {
  const payload: MomentEndPayload = { id };
  emitToTv(io, room.code, SOCKET_EVENTS.MOMENT_END, payload);
}

// ---- Dedications: a priority-3 moment for a song's first 20s ----

export const dedicationMomentId = (itemId: string) => `dedication-${itemId}`;

/** The TV shows this as a line in the now-playing card, not a takeover; it
 * still goes through the moment engine so a contest or reveal outranks it. */
function dedicationMoment(item: QueueItem, startedAtMs: number, splash: boolean): Moment<TakeoverPayload> {
  return {
    id: dedicationMomentId(item.id),
    kind: "dedication",
    priority: 3,
    payload: { question: item.dedication ?? "", splash },
    minMs: 1000,
    until: startedAtMs + DEDICATION_TV_MS,
  };
}

/** Called when a song starts (or the TV reconnects, or the host un-hides):
 * show the dedication if it has one and its 20s window hasn't passed. */
export function announceDedication(io: Server, room: Room, item: QueueItem, opts: { splash?: boolean } = {}): void {
  if (!item.dedication || item.dedicationHidden || item.status !== "playing" || !item.startedAt) return;
  const startedAt = item.startedAt.getTime();
  if (Date.now() >= startedAt + DEDICATION_TV_MS) return;
  showMoment(io, room, dedicationMoment(item, startedAt, opts.splash ?? false));
}

/** A TV that connects mid-song still gets the line for what's left of the 20s. */
export function registerMomentHooks(getIO: () => Server): void {
  setVolumeProvider(getRoomVolume);
  setTvJoinHook((code) => {
    const room = getRoomByCode(code);
    const playing = room ? getPlayingItem(room.id) : undefined;
    if (room && playing) announceDedication(getIO(), room, playing);
  });
}
