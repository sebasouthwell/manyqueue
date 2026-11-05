import type { Server } from "socket.io";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  SOCKET_EVENTS,
  scoreGuessWho,
  type BanHistoryItem,
  type ContestHistoryItem,
  type GamesHistory,
  type GamesState,
  type GuessHistoryItem,
  type LiveGameView,
} from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { db } from "../db/client.js";
import { votes } from "../db/schema.js";
import { getGuestById } from "../db/guests.js";
import { getQueueItemById } from "../db/queue.js";
import { getBallots, listOpenTimedVotes } from "../db/votes.js";
import { emitToStaff } from "./socket-server.js";
import { getVoteEngine, setGamesNotifier } from "./votes.js";
import { getIO } from "./io-instance.js";
import { contestPoolPayload } from "./contest.js";

/** The live vote as staff see it: the question, per-option counts and the deadline. Guess counts stay hidden. */
export function liveGameFor(room: Room): LiveGameView | null {
  const open = listOpenTimedVotes(undefined, room.id)
    .filter((v) => v.type === "contest" || v.type === "ban" || v.type === "guess")
    .sort((a, b) => (a.deadlineAt ?? 0) - (b.deadlineAt ?? 0))[0];
  if (!open) return null;

  const counts = getVoteEngine().counts(open);
  const hidden = open.type === "guess";
  return {
    voteId: open.id,
    type: open.type,
    title: open.title ?? "",
    deadlineAt: open.deadlineAt ?? 0,
    total: counts.total,
    countsHidden: hidden,
    ...(open.type === "ban" && counts.threshold !== undefined ? { ban: { threshold: counts.threshold, active: counts.active ?? 0 } } : {}),
    options: (open.options ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      ...(o.sublabel ? { sublabel: o.sublabel } : {}),
      ...(o.emoji ? { emoji: o.emoji } : {}),
      count: hidden ? 0 : (counts.counts[o.id] ?? 0),
    })),
  };
}

export function gamesState(room: Room): GamesState {
  return { live: liveGameFor(room), contest: contestPoolPayload(room) };
}

// Tallies arrive up to 4 a second per vote; the host's card doesn't need more than that either.
const lastPush = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> | null }>();

/** Pushes the current games state to the host and co-hosts, at most 4 times a second. */
export function broadcastGames(io: Server, room: Room): void {
  const state = lastPush.get(room.id) ?? { at: 0, timer: null };
  lastPush.set(room.id, state);
  const send = () => {
    state.at = Date.now();
    state.timer = null;
    emitToStaff(io, room.code, SOCKET_EVENTS.GAMES_STATE, gamesState(room));
  };
  const wait = 250 - (Date.now() - state.at);
  if (wait <= 0) send();
  else if (!state.timer) state.timer = setTimeout(send, wait);
}

/** What happened in this room's games tonight, newest first. Guess Who only lists
 * picks that have been revealed, so this can't tell the host an adder early. */
export function gamesHistory(room: Room): GamesHistory {
  const closed = db
    .select()
    .from(votes)
    .where(and(eq(votes.roomId, room.id), inArray(votes.type, ["ban", "contest", "guess"]), inArray(votes.status, ["closed", "passed"])))
    .orderBy(desc(votes.openedAt))
    .limit(60)
    .all();

  const bans: BanHistoryItem[] = [];
  const guesses: GuessHistoryItem[] = [];
  const contests: ContestHistoryItem[] = [];

  for (const v of closed) {
    const result = v.result;
    const meta = (v.meta ?? {}) as Record<string, unknown>;
    const at = (v.closedAt ?? v.openedAt).getTime();

    if (v.type === "ban") {
      const caller = typeof meta.calledBy === "string" ? (getGuestById(meta.calledBy)?.nickname ?? null) : null;
      bans.push({
        id: v.id,
        at,
        trackName: String(meta.trackName ?? ""),
        artistName: String(meta.artistName ?? ""),
        calledBy: caller,
        outcome: meta.vetoed ? "host_kept" : result?.outcome === "passed" ? "banned" : "kept",
        yes: result?.counts.yes ?? 0,
        no: result?.counts.no ?? 0,
      });
    } else if (v.type === "guess") {
      const adderId = String(meta.adderId ?? "");
      const optionIds = Array.isArray(meta.optionIds) ? (meta.optionIds as string[]) : [];
      const item = typeof meta.queueItemId === "string" ? getQueueItemById(meta.queueItemId) : undefined;
      if (!item?.revealed) continue; // never list an adder before the reveal
      const score = scoreGuessWho(adderId, getBallots(v.id), optionIds);
      guesses.push({
        id: v.id,
        at,
        trackName: item.trackName,
        adder: getGuestById(adderId)?.nickname ?? "someone",
        guessers: score.totalGuessers,
        correct: score.correctGuessers.length,
      });
    } else if (v.type === "contest" && result) {
      const winner = (v.options ?? []).find((o) => o.id === result.winnerOptionId);
      const loser = (v.options ?? []).find((o) => o.id !== result.winnerOptionId);
      if (winner && loser && (result.outcome === "winner" || result.outcome === "tie_break" || result.outcome === "no_votes")) {
        contests.push({ id: v.id, at, winner: winner.label, loser: loser.label, outcome: result.outcome });
      }
    }
  }
  return { bans, guesses, contests };
}

/** Call once at startup: route vote and pool changes to the staff live game card. */
export function initGames(): void {
  setGamesNotifier((room) => broadcastGames(getIO(), room));
}
