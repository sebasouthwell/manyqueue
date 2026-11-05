import { diffSpotifyQueue, SOCKET_EVENTS, type QueueWarningPayload } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { getActiveQueueItems } from "../db/queue.js";
import { getPlayerQueueUris, skipToNext } from "../spotify.js";
import { getIO } from "./io-instance.js";
import { emitToStaff } from "./socket-server.js";

/** How many tracks were queued directly in Spotify ahead of the one we handed off. */
export async function checkQueueDrift(room: Room): Promise<number> {
  const locked = getActiveQueueItems(room.id).find((i) => i.status === "locked");
  const uris = await getPlayerQueueUris(room.hostId);
  return diffSpotifyQueue(uris, locked?.trackUri ?? null).foreignAhead;
}

export function broadcastQueueWarning(room: Room, foreignAhead: number): void {
  const payload: QueueWarningPayload = { foreignAhead };
  emitToStaff(getIO(), room.code, SOCKET_EVENTS.QUEUE_WARNING, payload);
}

/**
 * Spotify has no "remove from queue" call, so the only fix is to skip
 * through: the foreign tracks ahead of ours, plus the current song. Ends on
 * our locked track, which the player loop then picks up as usual.
 */
export async function fixQueueDrift(room: Room): Promise<number> {
  if (!room.deviceId) return 0;
  const foreign = await checkQueueDrift(room);
  for (let i = 0; i < foreign + 1 && foreign > 0; i++) {
    await skipToNext(room.hostId, room.deviceId);
  }
  broadcastQueueWarning(room, 0);
  return foreign;
}
