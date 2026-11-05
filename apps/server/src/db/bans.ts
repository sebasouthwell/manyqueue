import { and, eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "./client.js";
import { bannedTracks, votes } from "./schema.js";

export function banTrack(roomId: string, trackUri: string, voteId: string | null, database: DB = defaultDb): void {
  database
    .insert(bannedTracks)
    .values({ roomId, trackUri, voteId, createdAt: new Date() })
    .onConflictDoNothing()
    .run();
}

export function isTrackBanned(roomId: string, trackUri: string, database: DB = defaultDb): boolean {
  return !!database
    .select({ uri: bannedTracks.trackUri })
    .from(bannedTracks)
    .where(and(eq(bannedTracks.roomId, roomId), eq(bannedTracks.trackUri, trackUri)))
    .get();
}

export function listBannedUris(roomId: string, database: DB = defaultDb): Set<string> {
  return new Set(
    database.select({ uri: bannedTracks.trackUri }).from(bannedTracks).where(eq(bannedTracks.roomId, roomId)).all().map((r) => r.uri),
  );
}

/** When this guest last called a ban vote (epoch ms), whatever its outcome; null if never. */
export function lastBanCalledAt(roomId: string, guestId: string, database: DB = defaultDb): number | null {
  const rows = database
    .select({ meta: votes.meta, openedAt: votes.openedAt })
    .from(votes)
    .where(and(eq(votes.roomId, roomId), eq(votes.type, "ban")))
    .all();
  let latest: number | null = null;
  for (const r of rows) {
    if ((r.meta as { calledBy?: string } | null)?.calledBy !== guestId) continue;
    const at = r.openedAt.getTime();
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}
