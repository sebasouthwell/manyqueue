import { gameSpacingOk, songsUntilGameAllowed } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { db } from "../db/client.js";
import { votes } from "../db/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import { countSongsFinished } from "../db/queue.js";

/** Songs finished tonight: the clock the spacing rule runs on. */
export function songsFinished(room: Room): number {
  return countSongsFinished(room.id);
}

/** The finished-song count when the latest game (contest or ban vote) began, or null if none has. */
export function lastGameAtFinished(roomId: string): number | null {
  const rows = db
    .select({ meta: votes.meta })
    .from(votes)
    .where(and(eq(votes.roomId, roomId), inArray(votes.type, ["contest", "ban"])))
    .all();
  let last: number | null = null;
  for (const r of rows) {
    const idx = (r.meta as { songIndex?: number } | null)?.songIndex;
    if (typeof idx === "number" && (last === null || idx > last)) last = idx;
  }
  return last;
}

/** Whether a game may start now, and how many songs to wait if not. */
export function gameSpacing(room: Room): { ok: boolean; songsUntil: number } {
  const finished = songsFinished(room);
  const last = lastGameAtFinished(room.id);
  return { ok: gameSpacingOk(finished, last), songsUntil: songsUntilGameAllowed(finished, last) };
}
