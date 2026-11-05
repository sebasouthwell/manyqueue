import crypto from "node:crypto";
import type { Server } from "socket.io";
import {
  CONTEST_BLOCKER_TEXT,
  CONTEST_RESULT_MS,
  SOCKET_EVENTS,
  contestStartBlocker,
  songsUntilAutoContest,
  pickContestPair,
  type ContestPoolPayload,
  type Moment,
  type TakeoverChoice,
  type TakeoverPayload,
  type ToastPayload,
  type TokenUpdatePayload,
  type VoteResult,
} from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { getGuestById } from "../db/guests.js";
import { getActiveQueueItems, getQueueItemById, isMystery, serializeQueue } from "../db/queue.js";
import { getPoolEntry, listContestItems, listPoolEntries, removePoolEntry, serializePool, settleContest, type PoolEntry } from "../db/contest.js";
import { listOpenTimedVotes, type Vote } from "../db/votes.js";
import { getIO } from "./io-instance.js";
import { emitToGuest, emitToStaff, roomChannel } from "./socket-server.js";
import { endMoment, showMoment } from "./moments.js";
import { maybeApplyFairOrder, maybeRecomputeApprovalLockAt } from "./queue-recompute.js";
import { getVoteEngine, notifyGames, registerVoteHandler } from "./votes.js";
import { gameSpacing, songsFinished } from "./game-rules.js";

interface ContestMeta {
  entries: { entryId: string; queueItemId: string; enteredBy: string }[];
  /** Songs finished when it began, for the spacing between games. */
  songIndex?: number;
}

const contestMomentId = (voteId: string) => `contest-${voteId}`;

function metaOf(vote: Vote): ContestMeta {
  return (vote.meta as unknown as ContestMeta) ?? { entries: [] };
}

export function getRunningContest(roomId: string): Vote | undefined {
  return listOpenTimedVotes(undefined, roomId).find((v) => v.type === "contest");
}

/** The name shown next to an entered song. Anonymous picks hide it (Block 34 fills this in). */
function entrantLabel(guestId: string, mystery: boolean): string {
  if (mystery) return "🕵️ Mystery pick";
  const g = getGuestById(guestId);
  return g ? `${g.nickname} ${g.emoji}` : "";
}

/** Why a contest can't start right now (a key of CONTEST_BLOCKER_TEXT), or null. */
export function contestBlocker(room: Room, entries: PoolEntry[]) {
  const settings = getRoomSettings(room.id);
  const active = getActiveQueueItems(room.id);
  const playing = active.find((i) => i.status === "playing");
  const remainingMs = playing?.startedAt ? playing.startedAt.getTime() + playing.durationMs - Date.now() : null;
  return contestStartBlocker({
    running: !!getRunningContest(room.id),
    entries: entries.map((e) => ({ id: e.id, enteredBy: e.enteredBy, createdAt: e.createdAt.getTime(), losses: e.losses })),
    nextLocked: active.some((i) => i.status === "locked"),
    remainingMs,
    durationMs: settings.contestSeconds * 1000,
  });
}

export function contestPoolPayload(room: Room): ContestPoolPayload {
  const entries = listPoolEntries(room.id);
  const running = getRunningContest(room.id);
  const blocker = contestBlocker(room, entries);
  const settings = getRoomSettings(room.id);
  return {
    entries: serializePool(room.id),
    running: running ? { voteId: running.id, deadlineAt: running.deadlineAt ?? 0 } : null,
    blocker: blocker ? CONTEST_BLOCKER_TEXT[blocker] : null,
    nextAutoInSongs: settings.autoContest ? songsUntilAutoContest(songsFinished(room), settings.autoContestEverySongs) : null,
    spacingSongs: gameSpacing(room).songsUntil,
  };
}

/** Pushes the pool to the host and co-hosts. */
export function broadcastContestPool(io: Server, room: Room): void {
  emitToStaff(io, room.code, SOCKET_EVENTS.CONTEST_POOL, contestPoolPayload(room));
  notifyGames(room);
}

function choiceFor(entry: PoolEntry, item: { trackName: string; artistName: string; albumArtUrl: string | null; anonymous: boolean; revealed: boolean }): TakeoverChoice {
  return {
    id: entry.id,
    label: item.trackName,
    sublabel: item.artistName,
    artUrl: item.albumArtUrl,
    byline: entrantLabel(entry.enteredBy, isMystery(item)),
  };
}

export type StartContestResult =
  | { ok: true; voteId: string }
  | { ok: false; error: keyof typeof CONTEST_BLOCKER_TEXT | "invalid_entries" };

/** Opens a contest between the two oldest entries from different guests, or two the host chose. */
export function startContest(io: Server, room: Room, pick?: [string, string]): StartContestResult {
  const entries = listPoolEntries(room.id);
  const blocker = contestBlocker(room, entries);
  if (blocker) return { ok: false, error: blocker };

  let pair: [PoolEntry, PoolEntry] | null;
  if (pick) {
    const a = entries.find((e) => e.id === pick[0]);
    const b = entries.find((e) => e.id === pick[1]);
    if (!a || !b || a.id === b.id || a.enteredBy === b.enteredBy) return { ok: false, error: "invalid_entries" };
    pair = a.createdAt.getTime() <= b.createdAt.getTime() ? [a, b] : [b, a];
  } else {
    const lite = pickContestPair(entries.map((e) => ({ id: e.id, enteredBy: e.enteredBy, createdAt: e.createdAt.getTime(), losses: e.losses })));
    pair = lite ? [entries.find((e) => e.id === lite[0].id)!, entries.find((e) => e.id === lite[1].id)!] : null;
  }
  if (!pair) return { ok: false, error: "not_enough_entries" };

  // Pool songs are queue rows with status "contest", which the queue listings skip.
  const items = new Map(listContestItems(room.id).map((i) => [i.id, i]));
  const [first, second] = pair;
  const firstItem = items.get(first.queueItemId)!;
  const secondItem = items.get(second.queueItemId)!;
  const settings = getRoomSettings(room.id);

  const vote = getVoteEngine().open({
    roomId: room.id,
    type: "contest",
    title: "Which plays next?",
    instruction: "Tap the song you want",
    options: [
      { id: first.id, label: firstItem.trackName, sublabel: firstItem.artistName, albumArtUrl: firstItem.albumArtUrl },
      { id: second.id, label: secondItem.trackName, sublabel: secondItem.artistName, albumArtUrl: secondItem.albumArtUrl },
    ],
    durationMs: settings.contestSeconds * 1000,
    meta: {
      entries: [first, second].map((e) => ({ entryId: e.id, queueItemId: e.queueItemId, enteredBy: e.enteredBy })),
      songIndex: songsFinished(room),
    } satisfies ContestMeta,
  });

  const deadlineAt = vote.deadlineAt ?? Date.now();
  const payload: TakeoverPayload = {
    question: "Which plays next?",
    deadlineAt,
    instruction: "Vote on your phone",
    vs: true,
    voteId: vote.id,
    choices: [choiceFor(first, firstItem), choiceFor(second, secondItem)],
  };
  const moment: Moment<TakeoverPayload> = {
    id: contestMomentId(vote.id),
    kind: "contest",
    priority: 1,
    payload,
    minMs: 5000,
    until: deadlineAt + 1500,
  };
  showMoment(io, room, moment);
  broadcastContestPool(io, room);
  return { ok: true, voteId: vote.id };
}

function tokenUpdate(io: Server, room: Room, guestId: string, balance: number, delta: number, reason: TokenUpdatePayload["reason"]) {
  const payload: TokenUpdatePayload = { guestId, balance, delta, reason };
  emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
}

function privateToast(io: Server, room: Room, guestId: string, message: string, big = false) {
  const toast: ToastPayload = { id: crypto.randomUUID(), message, guestVisible: true, ...(big ? { big: true } : {}) };
  emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOAST, toast);
}

function mysteryOf(queueItemId: string): boolean {
  const item = getQueueItemById(queueItemId);
  return !!item && isMystery(item);
}

function percentOf(result: VoteResult, optionId: string): number {
  return result.total > 0 ? Math.round(((result.counts[optionId] ?? 0) / result.total) * 100) : 0;
}

function onContestClosed(vote: Vote, result: VoteResult, room: Room): void {
  if (room.status !== "active") return;
  const io = getIO();
  const meta = metaOf(vote);
  const entries = meta.entries.map((e) => ({ ...e, entry: getPoolEntry(e.entryId) }));
  const gone = entries.filter((e) => !e.entry || getGuestById(e.enteredBy)?.kickedAt);

  // An entrant left (kicked, or their entry was removed) mid-vote: no result, nobody loses.
  if (gone.length > 0 || !result.winnerOptionId) {
    for (const e of entries) {
      if (e.entry && gone.includes(e)) {
        const removed = removePoolEntry(e.entry.id, "refund_reject", getRoomSettings(room.id).tokenCap);
        if (removed?.balance != null) tokenUpdate(io, room, e.enteredBy, removed.balance, removed.item.paid, "refund_reject");
      }
    }
    endMoment(io, room, contestMomentId(vote.id));
    const cancelled: ToastPayload = { id: crypto.randomUUID(), message: "The song contest was cancelled", emoji: "🏆" };
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, cancelled);
    broadcastContestPool(io, room);
    return;
  }

  const winner = entries.find((e) => e.entryId === result.winnerOptionId)!;
  const loser = entries.find((e) => e.entryId !== result.winnerOptionId)!;
  const settings = getRoomSettings(room.id);
  const settled = settleContest({ winnerEntryId: winner.entryId, loserEntryId: loser.entryId, tokenCap: settings.tokenCap });

  maybeApplyFairOrder(room);
  maybeRecomputeApprovalLockAt(room);
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));

  if (settled.winnerBalance !== null) tokenUpdate(io, room, winner.enteredBy, settled.winnerBalance, settled.winnerItem.paid || 1, "refund_contest");
  privateToast(io, room, winner.enteredBy, "Your song won! Token refunded 🪙", true);
  privateToast(
    io,
    room,
    loser.enteredBy,
    settled.loserJoinedQueue ? "So close — it's been added to the queue" : "So close — you'll get another shot",
  );

  // The TV holds the result for 4s: winner grows, loser fades.
  const choices: TakeoverChoice[] = entries.map((e) => {
    const opt = (vote.options ?? []).find((o) => o.id === e.entryId)!;
    return {
      id: e.entryId,
      label: opt.label,
      sublabel: opt.sublabel,
      artUrl: opt.albumArtUrl ?? null,
      byline: entrantLabel(e.enteredBy, mysteryOf(e.queueItemId)),
      percent: percentOf(result, e.entryId),
    };
  });
  const winnerLabel = (vote.options ?? []).find((o) => o.id === winner.entryId)!.label;
  const resultText =
    result.outcome === "no_votes"
      ? `Nobody voted, so ${winnerLabel} goes first`
      : result.outcome === "tie_break"
        ? `A tie: ${winnerLabel} was entered first`
        : `${winnerLabel} plays next`;
  endMoment(io, room, contestMomentId(vote.id));
  showMoment(io, room, {
    id: `${contestMomentId(vote.id)}-result`,
    kind: "contest",
    priority: 1,
    payload: {
      question: "Which plays next?",
      vs: true,
      voteId: vote.id,
      choices,
      winnerChoiceId: winner.entryId,
      resultText,
    } satisfies TakeoverPayload,
    minMs: CONTEST_RESULT_MS,
    until: Date.now() + CONTEST_RESULT_MS,
  });
  const toast: ToastPayload = { id: crypto.randomUUID(), message: `${winnerLabel} won the contest`, emoji: "🏆" };
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, toast);
  broadcastContestPool(io, room);
}

/** Registers the contest rules with the shared vote engine. Call once at startup. */
export function initContests(): void {
  registerVoteHandler("contest", {
    decorate(vote, guestId, option) {
      const own = metaOf(vote).entries.find((e) => e.entryId === option.id)?.enteredBy === guestId;
      return own ? { ...option, disabledReason: "Your song" } : option;
    },
    validateBallot(vote, guestId, optionId) {
      const own = metaOf(vote).entries.find((e) => e.entryId === optionId)?.enteredBy === guestId;
      return own ? "Your song" : null;
    },
    summarize(vote, result) {
      const winner = (vote.options ?? []).find((o) => o.id === result.winnerOptionId);
      if (!winner) return undefined;
      if (result.outcome === "no_votes") return `Nobody voted: ${winner.label} goes first`;
      if (result.outcome === "tie_break") return `A tie: ${winner.label} was entered first`;
      return `${winner.label} plays next`;
    },
    onClosed: onContestClosed,
  });
}

/** Host or co-host ends the running contest now; whatever the votes are, they count. */
export function endContestNow(room: Room): boolean {
  const running = getRunningContest(room.id);
  if (!running) return false;
  return getVoteEngine().closeNow(running.id) !== null;
}

