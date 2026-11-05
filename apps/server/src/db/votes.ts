import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Ballot, VoteOptionSpec, VoteResult, VoteType } from "@manyqueue/shared";
import { db, type DB } from "./client.js";
import { votes, voteBallots, guests } from "./schema.js";

export type Vote = typeof votes.$inferSelect;

export function getOpenVote(roomId: string, targetQueueItemId: string, type: "skip"): Vote | undefined {
  return db
    .select()
    .from(votes)
    .where(
      and(
        eq(votes.roomId, roomId),
        eq(votes.targetQueueItemId, targetQueueItemId),
        eq(votes.type, type),
        eq(votes.status, "open"),
      ),
    )
    .get();
}

export function createVote(roomId: string, targetQueueItemId: string, type: "skip"): Vote {
  const vote: Vote = {
    id: crypto.randomUUID(),
    roomId,
    type,
    targetQueueItemId,
    status: "open",
    openedAt: new Date(),
    closedAt: null,
    title: null,
    instruction: null,
    options: null,
    deadlineAt: null,
    result: null,
    meta: null,
  };
  db.insert(votes).values(vote).run();
  return vote;
}

export function getOrCreateOpenVote(roomId: string, targetQueueItemId: string, type: "skip"): Vote {
  return getOpenVote(roomId, targetQueueItemId, type) ?? createVote(roomId, targetQueueItemId, type);
}

/** Returns the ballot state after toggling: true if now voted, false if withdrawn. */
export function toggleBallot(voteId: string, guestId: string): boolean {
  const existing = db
    .select()
    .from(voteBallots)
    .where(and(eq(voteBallots.voteId, voteId), eq(voteBallots.guestId, guestId)))
    .get();

  if (existing) {
    db.delete(voteBallots)
      .where(and(eq(voteBallots.voteId, voteId), eq(voteBallots.guestId, guestId)))
      .run();
    return false;
  }

  db.insert(voteBallots).values({ voteId, guestId, castAt: new Date() }).run();
  return true;
}

export function hasBallot(voteId: string, guestId: string): boolean {
  return !!db
    .select()
    .from(voteBallots)
    .where(and(eq(voteBallots.voteId, voteId), eq(voteBallots.guestId, guestId)))
    .get();
}

export function countBallots(voteId: string): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(voteBallots)
    .where(eq(voteBallots.voteId, voteId))
    .get();
  return row?.count ?? 0;
}

export function closeVote(voteId: string): void {
  db.update(votes).set({ status: "closed", closedAt: new Date() }).where(eq(votes.id, voteId)).run();
}

// ---- Timed votes (contest / ban / guess): options + a deadline + a result ----

export interface NewTimedVote {
  roomId: string;
  type: VoteType;
  title: string;
  instruction?: string;
  options: VoteOptionSpec[];
  deadlineAt: number;
  targetQueueItemId?: string;
  meta?: Record<string, unknown>;
}

export function createTimedVote(input: NewTimedVote, database: DB = db): Vote {
  const vote: Vote = {
    id: crypto.randomUUID(),
    roomId: input.roomId,
    type: input.type,
    targetQueueItemId: input.targetQueueItemId ?? null,
    status: "open",
    openedAt: new Date(),
    closedAt: null,
    title: input.title,
    instruction: input.instruction ?? null,
    options: input.options,
    deadlineAt: input.deadlineAt,
    result: null,
    meta: input.meta ?? null,
  };
  database.insert(votes).values(vote).run();
  return vote;
}

export function getVoteById(id: string, database: DB = db): Vote | undefined {
  return database.select().from(votes).where(eq(votes.id, id)).get();
}

/** Every open vote that has a deadline — what a restarted server re-arms. */
export function listOpenTimedVotes(database: DB = db, roomId?: string): Vote[] {
  return database
    .select()
    .from(votes)
    .where(roomId ? and(eq(votes.status, "open"), eq(votes.roomId, roomId)) : eq(votes.status, "open"))
    .all()
    .filter((v) => v.deadlineAt !== null);
}

export function getBallot(voteId: string, guestId: string, database: DB = db): Ballot | undefined {
  const row = database
    .select()
    .from(voteBallots)
    .where(and(eq(voteBallots.voteId, voteId), eq(voteBallots.guestId, guestId)))
    .get();
  return row && row.optionId
    ? { guestId: row.guestId, optionId: row.optionId, castAt: row.castAt.getTime() }
    : undefined;
}

export function getBallots(voteId: string, database: DB = db): Ballot[] {
  return database
    .select()
    .from(voteBallots)
    .where(eq(voteBallots.voteId, voteId))
    .all()
    .filter((r) => r.optionId)
    .map((r) => ({ guestId: r.guestId, optionId: r.optionId as string, castAt: r.castAt.getTime() }));
}

/** One row per guest per vote: a second cast replaces the first. */
export function upsertBallot(voteId: string, guestId: string, optionId: string, castAt: number, database: DB = db): void {
  database
    .insert(voteBallots)
    .values({ voteId, guestId, optionId, castAt: new Date(castAt) })
    .onConflictDoUpdate({
      target: [voteBallots.voteId, voteBallots.guestId],
      set: { optionId, castAt: new Date(castAt) },
    })
    .run();
}

export function closeTimedVote(voteId: string, result: VoteResult, passed: boolean, database: DB = db): void {
  database
    .update(votes)
    .set({ status: passed ? "passed" : "closed", closedAt: new Date(), result })
    .where(eq(votes.id, voteId))
    .run();
}

/** Guests who may still have a ballot counted: in the room and not kicked. */
export function eligibleGuestIds(roomId: string, database: DB = db): Set<string> {
  return new Set(
    database
      .select({ id: guests.id, kickedAt: guests.kickedAt })
      .from(guests)
      .where(eq(guests.roomId, roomId))
      .all()
      .filter((g) => !g.kickedAt)
      .map((g) => g.id),
  );
}

export function setVoteMeta(voteId: string, meta: Record<string, unknown>, database: DB = db): void {
  database.update(votes).set({ meta }).where(eq(votes.id, voteId)).run();
}
