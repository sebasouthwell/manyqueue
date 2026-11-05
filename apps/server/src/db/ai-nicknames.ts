import { and, desc, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type DB } from "./client.js";
import { aiNicknames, aiUsage } from "./schema.js";

export type AiNicknameRow = typeof aiNicknames.$inferSelect;
export type AiNicknameStatus = AiNicknameRow["status"];

/** A guest's newest nickname row of any status (hidden ones count: the host's Hide isn't undone by a re-roll of the same word). */
export function latestNicknameFor(roomId: string, guestId: string, database: DB = defaultDb): AiNicknameRow | undefined {
  return database
    .select()
    .from(aiNicknames)
    .where(and(eq(aiNicknames.roomId, roomId), eq(aiNicknames.guestId, guestId)))
    .orderBy(desc(aiNicknames.generatedAt), desc(aiNicknames.id))
    .get();
}

/** Every guest's newest row for the room, newest first. */
export function listLatestNicknames(roomId: string, database: DB = defaultDb): AiNicknameRow[] {
  const rows = database
    .select()
    .from(aiNicknames)
    .where(eq(aiNicknames.roomId, roomId))
    .orderBy(desc(aiNicknames.generatedAt), desc(aiNicknames.id))
    .all();
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.guestId) ? false : (seen.add(r.guestId), true)));
}

export function getNicknameById(id: string, database: DB = defaultDb): AiNicknameRow | undefined {
  return database.select().from(aiNicknames).where(eq(aiNicknames.id, id)).get();
}

export function insertNickname(
  row: { roomId: string; guestId: string; nickname: string; why: string; status: AiNicknameStatus; atFinished: number; now?: Date },
  database: DB = defaultDb,
): AiNicknameRow {
  const values = {
    id: crypto.randomUUID(),
    roomId: row.roomId,
    guestId: row.guestId,
    nickname: row.nickname,
    why: row.why,
    generatedAt: row.now ?? new Date(),
    status: row.status,
    atFinished: row.atFinished,
    announcedAt: null,
  };
  database.insert(aiNicknames).values(values).run();
  return values;
}

export function setNicknameStatus(id: string, status: AiNicknameStatus, database: DB = defaultDb): void {
  database.update(aiNicknames).set({ status }).where(eq(aiNicknames.id, id)).run();
}

export function markNicknameAnnounced(id: string, now: Date = new Date(), database: DB = defaultDb): void {
  database.update(aiNicknames).set({ announcedAt: now }).where(eq(aiNicknames.id, id)).run();
}

/** Nicknames that are visible but that the TV hasn't announced yet, oldest first. */
export function unannouncedShown(roomId: string, database: DB = defaultDb): AiNicknameRow[] {
  return database
    .select()
    .from(aiNicknames)
    .where(and(eq(aiNicknames.roomId, roomId), eq(aiNicknames.status, "shown"), isNull(aiNicknames.announcedAt)))
    .orderBy(aiNicknames.generatedAt)
    .all();
}

export function listPendingNicknames(roomId: string, database: DB = defaultDb): AiNicknameRow[] {
  return database
    .select()
    .from(aiNicknames)
    .where(and(eq(aiNicknames.roomId, roomId), eq(aiNicknames.status, "pending")))
    .orderBy(aiNicknames.generatedAt)
    .all();
}

export interface AiUsageRow {
  nicknameCalls: number;
  genreCalls: number;
}

export function getAiUsage(roomId: string, database: DB = defaultDb): AiUsageRow {
  const row = database.select().from(aiUsage).where(eq(aiUsage.roomId, roomId)).get();
  return { nicknameCalls: row?.nicknameCalls ?? 0, genreCalls: row?.genreCalls ?? 0 };
}

export function bumpAiUsage(roomId: string, kind: "nickname" | "genre", database: DB = defaultDb): AiUsageRow {
  const now = getAiUsage(roomId, database);
  const next = {
    nicknameCalls: now.nicknameCalls + (kind === "nickname" ? 1 : 0),
    genreCalls: now.genreCalls + (kind === "genre" ? 1 : 0),
  };
  database
    .insert(aiUsage)
    .values({ roomId, ...next })
    .onConflictDoUpdate({ target: aiUsage.roomId, set: next })
    .run();
  return next;
}

/** What a guest shows tonight: their newest nickname that is visible (pending and hidden ones don't count). */
export function shownNicknameFor(roomId: string, guestId: string, database: DB = defaultDb): AiNicknameRow | undefined {
  return database
    .select()
    .from(aiNicknames)
    .where(and(eq(aiNicknames.roomId, roomId), eq(aiNicknames.guestId, guestId), eq(aiNicknames.status, "shown")))
    .orderBy(desc(aiNicknames.generatedAt), desc(aiNicknames.id))
    .get();
}

/** Hide (the host's Hide): every nickname the guest has, so an older one can't reappear. */
export function hideAllNicknamesFor(roomId: string, guestId: string, database: DB = defaultDb): void {
  database
    .update(aiNicknames)
    .set({ status: "hidden" })
    .where(and(eq(aiNicknames.roomId, roomId), eq(aiNicknames.guestId, guestId)))
    .run();
}

export function listAllPendingNicknames(database: DB = defaultDb): AiNicknameRow[] {
  return database.select().from(aiNicknames).where(eq(aiNicknames.status, "pending")).all();
}
