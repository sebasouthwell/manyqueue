import {
  VOTE_TALLY_MAX_PER_SECOND,
  banThreshold,
  resolve,
  type VoteCountsPayload,
  type VoteOptionSpec,
  type VoteResult,
  type VoteType,
} from "@manyqueue/shared";
import { db as defaultDb, type DB } from "../db/client.js";
import {
  closeTimedVote,
  createTimedVote,
  eligibleGuestIds,
  getBallot,
  getBallots,
  getVoteById,
  listOpenTimedVotes,
  upsertBallot,
  type Vote,
} from "../db/votes.js";

export interface VoteEngineHooks {
  /** Guests currently connected to the room — what thresholds are measured against. */
  activeCount(roomId: string): number;
  onOpened(vote: Vote): void;
  onTally(vote: Vote, counts: VoteCountsPayload): void;
  onClosed(vote: Vote, result: VoteResult): void;
  /** A reason string ("Your song") to refuse a ballot, or null to accept it. */
  validateBallot?(vote: Vote, guestId: string, optionId: string): string | null;
}

export interface OpenVoteInput {
  roomId: string;
  type: VoteType;
  title: string;
  instruction?: string;
  options: VoteOptionSpec[];
  durationMs: number;
  targetQueueItemId?: string;
  meta?: Record<string, unknown>;
}

export type CastOutcome =
  | { ok: true; optionId: string }
  | { ok: false; error: "vote_not_found" | "vote_closed" | "invalid_option" | "not_in_room" | "already_voted" | "not_allowed"; reason?: string };

const MIN_TALLY_GAP_MS = 1000 / VOTE_TALLY_MAX_PER_SECOND;

/**
 * One engine for every vote type. It owns the clock (a timer per open vote,
 * re-armed from the DB after a restart), the ballots (one per guest,
 * changeable until the deadline — except guess votes, where the first choice
 * is final) and the throttled live tally; what a vote *means* lives in
 * resolve() and in whoever handles onClosed. It knows nothing about sockets.
 */
export function createVoteEngine(hooks: VoteEngineHooks, database: DB = defaultDb) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const tally = new Map<string, { lastEmitAt: number; timer: ReturnType<typeof setTimeout> | null }>();

  function arm(vote: Vote): void {
    if (vote.deadlineAt === null) return;
    clear(vote.id);
    const timer = setTimeout(() => closeNow(vote.id), Math.max(0, vote.deadlineAt - Date.now()));
    timer.unref?.();
    timers.set(vote.id, timer);
  }

  function clear(voteId: string): void {
    const t = timers.get(voteId);
    if (t) clearTimeout(t);
    timers.delete(voteId);
    const s = tally.get(voteId);
    if (s?.timer) clearTimeout(s.timer);
    tally.delete(voteId);
  }

  function counts(vote: Vote): VoteCountsPayload {
    const result = resolve(
      { type: vote.type, options: vote.options ?? [], threshold: thresholdOf(vote) },
      getBallots(vote.id, database),
      hooks.activeCount(vote.roomId),
      eligibleGuestIds(vote.roomId, database),
    );
    const payload: VoteCountsPayload = { voteId: vote.id, counts: result.counts, total: result.total };
    if (vote.type === "ban") {
      const active = hooks.activeCount(vote.roomId);
      payload.threshold = banThreshold(active);
      payload.active = active;
    }
    return payload;
  }

  function emitTally(vote: Vote): void {
    const state = tally.get(vote.id) ?? { lastEmitAt: 0, timer: null };
    tally.set(vote.id, state);
    const sinceLast = Date.now() - state.lastEmitAt;
    if (sinceLast >= MIN_TALLY_GAP_MS) {
      state.lastEmitAt = Date.now();
      hooks.onTally(vote, counts(vote));
      return;
    }
    if (state.timer) return; // the trailing emit already scheduled will carry the latest counts
    state.timer = setTimeout(() => {
      state.timer = null;
      state.lastEmitAt = Date.now();
      const fresh = getVoteById(vote.id, database);
      if (fresh?.status === "open") hooks.onTally(fresh, counts(fresh));
    }, MIN_TALLY_GAP_MS - sinceLast);
    state.timer.unref?.();
  }

  function open(input: OpenVoteInput): Vote {
    const vote = createTimedVote({ ...input, deadlineAt: Date.now() + input.durationMs }, database);
    arm(vote);
    hooks.onOpened(vote);
    return vote;
  }

  function cast(voteId: string, guestId: string, optionId: string): CastOutcome {
    const vote = getVoteById(voteId, database);
    if (!vote) return { ok: false, error: "vote_not_found" };
    if (vote.status !== "open" || vote.deadlineAt === null || Date.now() >= vote.deadlineAt) {
      return { ok: false, error: "vote_closed" };
    }
    if (!(vote.options ?? []).some((o) => o.id === optionId)) return { ok: false, error: "invalid_option" };
    if (!eligibleGuestIds(vote.roomId, database).has(guestId)) return { ok: false, error: "not_in_room" };
    if (vote.type === "guess" && getBallot(voteId, guestId, database)) return { ok: false, error: "already_voted" };
    const refusal = hooks.validateBallot?.(vote, guestId, optionId);
    if (refusal) return { ok: false, error: "not_allowed", reason: refusal };

    upsertBallot(voteId, guestId, optionId, Date.now(), database);
    emitTally(vote);
    return { ok: true, optionId };
  }

  /** Closes the vote (a no-op if it already closed) and reports the result.
   * `override` replaces the computed result, e.g. a host veto that keeps the song. */
  function closeNow(voteId: string, override?: (computed: VoteResult) => VoteResult): VoteResult | null {
    const vote = getVoteById(voteId, database);
    clear(voteId);
    if (!vote || vote.status !== "open") return null;
    const computed = resolve(
      { type: vote.type, options: vote.options ?? [], threshold: thresholdOf(vote) },
      getBallots(voteId, database),
      hooks.activeCount(vote.roomId),
      eligibleGuestIds(vote.roomId, database),
    );
    const result = override ? override(computed) : computed;
    closeTimedVote(voteId, result, result.outcome === "passed", database);
    hooks.onClosed({ ...vote, status: result.outcome === "passed" ? "passed" : "closed" }, result);
    return result;
  }

  /** After a restart: arm every vote still open in the DB. One already past its
   * deadline closes on the next tick. */
  function rearm(): number {
    const open = listOpenTimedVotes(database);
    for (const vote of open) arm(vote);
    return open.length;
  }

  function stop(): void {
    for (const id of [...timers.keys(), ...tally.keys()]) clear(id);
  }

  return { open, cast, closeNow, rearm, stop, counts };
}

function thresholdOf(vote: Vote): number | undefined {
  const t = vote.meta?.threshold;
  return typeof t === "number" ? t : undefined;
}

export type VoteEngine = ReturnType<typeof createVoteEngine>;
