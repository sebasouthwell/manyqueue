import type { Server } from "socket.io";
import { SOCKET_EVENTS, isAllIWantForChristmas, isDefrostSeason, type DefrostPayload } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import type { QueueItem } from "../db/queue.js";
import { getRoomSettings } from "../db/settings.js";
import { getGuestById } from "../db/guests.js";
import { pausePlayback, resumePlayback, seekPlayback } from "../spotify.js";
import { roomChannel } from "./socket-server.js";

/** How long the TV holds the ice before it shatters and the song starts over from 0:00. */
export const DEFROST_MS = 10_000;

/** Room id -> the night it already defrosted ("once per room per night"). */
const defrostedOn = new Map<string, string>();
/** Rooms holding Spotify paused for the moment right now: the player loop leaves them alone. */
const holding = new Set<string>();

/** A night runs into the small hours: 3am still counts as the evening before. */
const nightOf = (now: Date) => new Date(now.getTime() - 6 * 3_600_000).toDateString();

export function isDefrostHolding(roomId: string): boolean {
  return holding.has(roomId);
}

export function resetDefrostForTests(): void {
  defrostedOn.clear();
  holding.clear();
}

/**
 * WARNING WARNING: SHE IS DEFROSTING. The first Mariah Carey "All I Want for Christmas Is You" of a
 * November night: as she starts, pause her, ice the TV over (cracking, then shattering; a dedication
 * takes the place of the warning), then start her again from the top. Returns whether it ran.
 */
export function maybeDefrost(
  io: Server,
  room: Room,
  item: QueueItem,
  deps: {
    pause: typeof pausePlayback;
    resume: typeof resumePlayback;
    seek: typeof seekPlayback;
    now: () => Date;
    holidayMode: (roomId: string) => string;
    nickname: (guestId: string) => string | null;
  } = {
    pause: pausePlayback,
    resume: resumePlayback,
    seek: seekPlayback,
    now: () => new Date(),
    holidayMode: (roomId) => getRoomSettings(roomId).holidayMode,
    nickname: (guestId) => getGuestById(guestId)?.nickname ?? null,
  },
): boolean {
  const now = deps.now();
  if (!room.deviceId || !isDefrostSeason(now) || !isAllIWantForChristmas(item.trackName, item.artistName)) return false;
  if (deps.holidayMode(room.id) === "off") return false;
  const night = nightOf(now);
  if (defrostedOn.get(room.id) === night) return false;
  defrostedOn.set(room.id, night);

  const showDedication = !!item.dedication && !item.dedicationHidden;
  const from = showDedication && item.addedBy && !item.anonymous ? deps.nickname(item.addedBy) : null;
  const payload: DefrostPayload = {
    queueItemId: item.id,
    dedication: showDedication ? item.dedication : null,
    from,
    durationMs: DEFROST_MS,
  };
  console.log(`[defrost:${room.code}] she is defrosting${payload.dedication ? " (with a dedication)" : ""}: holding Spotify for ${DEFROST_MS / 1000}s`);
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.DEFROST, payload);

  const deviceId = room.deviceId;
  holding.add(room.id);
  void deps.pause(room.hostId, deviceId).catch((err) => console.warn(`[defrost:${room.code}] pause failed:`, err));
  setTimeout(() => {
    void (async () => {
      try {
        await deps.seek(room.hostId, deviceId, 0).catch(() => {});
        await deps.resume(room.hostId, deviceId);
      } catch (err) {
        // One more go: a party left paused on its biggest song is the worst outcome here.
        console.warn(`[defrost:${room.code}] resume failed, retrying:`, err);
        await new Promise((r) => setTimeout(r, 1500));
        await deps.resume(room.hostId, deviceId).catch((e) => console.error(`[defrost:${room.code}] resume failed again:`, e));
      } finally {
        holding.delete(room.id);
      }
    })();
  }, DEFROST_MS);
  return true;
}
