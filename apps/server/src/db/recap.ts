import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { RecapData, RecapGuest, RecapSong } from "@manyqueue/shared";
import { db as defaultDb, type DB } from "./client.js";
import { bannedTracks, guests, queueItems, reactionsAgg, rooms } from "./schema.js";
import { listEarnedLabels } from "./label-stats.js";
import { shownNicknameFor } from "./ai-nicknames.js";

const COUNTED = ["played", "skipped", "playing", "locked", "queued"] as const;

/**
 * Everything the recap shows, from data already kept. A mystery pick nobody revealed has no name on it
 * (in songs, in the crew list, in reaction credit), same as everywhere else in the app.
 */
export function buildRecap(roomId: string, now: Date = new Date(), database: DB = defaultDb): RecapData | null {
  const room = database.select().from(rooms).where(eq(rooms.id, roomId)).get();
  if (!room) return null;

  const allGuests = database.select().from(guests).where(and(eq(guests.roomId, roomId), isNull(guests.kickedAt))).all();
  const guestById = new Map(allGuests.map((g) => [g.id, g]));
  const items = database.select().from(queueItems).where(eq(queueItems.roomId, roomId)).all();
  const hidden = (i: (typeof items)[number]) => i.anonymous && !i.revealed;
  const played = items.filter((i) => i.status === "played").sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0));

  const reactionRows = items.length
    ? database.select().from(reactionsAgg).where(inArray(reactionsAgg.queueItemId, items.map((i) => i.id))).all()
    : [];
  const fireBy = new Map<string, number>();
  const totalBy = new Map<string, number>();
  for (const r of reactionRows) {
    totalBy.set(r.queueItemId, (totalBy.get(r.queueItemId) ?? 0) + r.count);
    if (r.emoji === "🔥") fireBy.set(r.queueItemId, (fireBy.get(r.queueItemId) ?? 0) + r.count);
  }

  const song = (i: (typeof items)[number]): RecapSong => {
    const g = i.addedBy && !hidden(i) ? guestById.get(i.addedBy) : undefined;
    return { title: i.trackName, artist: i.artistName, albumArtUrl: i.albumArtUrl, by: g ? { name: g.nickname, emoji: g.emoji } : null };
  };

  let best: (typeof items)[number] | null = null;
  for (const i of played) if ((fireBy.get(i.id) ?? 0) > (best ? fireBy.get(best.id) ?? 0 : 0)) best = i;

  const plays = new Map<string, (typeof items)[number][]>();
  for (const i of played) plays.set(i.trackUri, [...(plays.get(i.trackUri) ?? []), i]);
  let replayed: (typeof items)[number][] = [];
  for (const list of plays.values()) if (list.length >= 2 && list.length > replayed.length) replayed = list;

  const bans = database.select().from(bannedTracks).where(eq(bannedTracks.roomId, roomId)).all();
  const banned = bans.map((b) => {
    const it = items.find((i) => i.trackUri === b.trackUri);
    return { title: it?.trackName ?? "A song", artist: it?.artistName ?? "" };
  });

  const labelsBy = new Map<string, { emoji: string; name: string }[]>();
  for (const l of listEarnedLabels(roomId, database)) labelsBy.set(l.guestId, [...(labelsBy.get(l.guestId) ?? []), { emoji: l.emoji, name: l.name }]);
  const songsBy = new Map<string, number>();
  const gotBy = new Map<string, number>();
  for (const i of items) {
    if (!i.addedBy || hidden(i) || !(COUNTED as readonly string[]).includes(i.status)) continue;
    if (i.status === "skipped" && !i.startedAt) continue; // removed or rejected before it started: never played
    songsBy.set(i.addedBy, (songsBy.get(i.addedBy) ?? 0) + 1);
    gotBy.set(i.addedBy, (gotBy.get(i.addedBy) ?? 0) + (totalBy.get(i.id) ?? 0));
  }
  const crew: RecapGuest[] = allGuests
    .map((g) => {
      const n = shownNicknameFor(roomId, g.id, database);
      return {
        name: g.nickname,
        emoji: g.emoji,
        songs: songsBy.get(g.id) ?? 0,
        reactionsGot: gotBy.get(g.id) ?? 0,
        labels: labelsBy.get(g.id) ?? [],
        nickname: n ? { nickname: n.nickname, why: n.why } : null,
      };
    })
    .sort((a, b) => b.songs - a.songs || b.reactionsGot - a.reactionsGot || a.name.localeCompare(b.name));

  const start = room.createdAt.getTime();
  const end = room.endedAt?.getTime() ?? now.getTime();
  return {
    room: { name: room.name, code: room.code, startedAt: start, endedAt: room.endedAt?.getTime() ?? null, durationMs: Math.max(0, end - start) },
    totals: {
      songs: played.length,
      guests: allGuests.length,
      reactions: reactionRows.reduce((sum, r) => sum + r.count, 0),
    },
    songOfTheNight: best ? { ...song(best), fire: fireBy.get(best.id) ?? 0, reactions: totalBy.get(best.id) ?? 0 } : null,
    mostReplayed: replayed.length >= 2 ? { ...song(replayed[0]!), plays: replayed.length } : null,
    banned,
    guests: crew,
  };
}
