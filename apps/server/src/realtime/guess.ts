import crypto from "node:crypto";
import type { Server } from "socket.io";
import {
  GUESS_VOTE_SECONDS,
  QUICK_GUESS_SECONDS,
  REVEAL_HOLD_MS,
  SOCKET_EVENTS,
  pickGuessOptions,
  scoreGuessWho,
  type GuessResultPayload,
  type TakeoverPayload,
  type ToastPayload,
  type TokenUpdatePayload,
  type VoteResult,
} from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { getGuestById } from "../db/guests.js";
import { getQueueItemById, isMystery, markCasualMystery, markRevealed, serializeQueue, type QueueItem } from "../db/queue.js";
import { apply, TokenCapExceededError } from "../db/tokens.js";
import { getBallots, listOpenTimedVotes, type Vote } from "../db/votes.js";
import { getIO } from "./io-instance.js";
import { emitToGuest, getConnectedGuestIds, roomChannel } from "./socket-server.js";
import { endMoment, showMoment } from "./moments.js";
import { getVoteEngine, registerVoteHandler } from "./votes.js";

interface GuessMeta {
  queueItemId: string;
  adderId: string;
  optionIds: string[];
  /** A for-fun round on an ordinary song: nobody is hidden, no tokens, no takeover. */
  casual?: boolean;
}

const guessMomentId = (voteId: string) => `guess-${voteId}`;
const metaOf = (vote: Vote) => vote.meta as unknown as GuessMeta;

function openGuessVoteFor(roomId: string, queueItemId: string): Vote | undefined {
  return listOpenTimedVotes(undefined, roomId).find((v) => v.type === "guess" && metaOf(v).queueItemId === queueItemId);
}

/**
 * A mystery pick just started playing: open a 45s "who queued it?" vote. The
 * options are the real adder plus up to three other guests who are here right
 * now, shuffled so the answer has no fixed slot. With nobody else around there
 * is nothing to guess between, so it simply reveals when the song ends.
 */
export function startGuessVote(io: Server, room: Room, item: QueueItem): void {
  if (!isMystery(item) || !item.addedBy || openGuessVoteFor(room.id, item.id)) return;
  const adderId = item.addedBy;
  const present = [...getConnectedGuestIds(io, room.code)].filter((id) => id !== adderId && !getGuestById(id)?.kickedAt);
  const optionIds = pickGuessOptions(adderId, present);
  if (optionIds.length < 2) return;

  const options = optionIds.flatMap((id) => {
    const g = getGuestById(id);
    return g ? [{ id, label: g.nickname, emoji: g.emoji }] : [];
  });
  const vote = getVoteEngine().open({
    roomId: room.id,
    type: "guess",
    title: "Who queued this?",
    instruction: "Your first pick is final",
    options,
    durationMs: Math.min(GUESS_VOTE_SECONDS * 1000, item.durationMs),
    targetQueueItemId: item.id,
    meta: { queueItemId: item.id, adderId, optionIds } satisfies GuessMeta as unknown as Record<string, unknown>,
  });

  // The TV shows a line in the now-playing card, not a takeover: the song stays on screen.
  showMoment(io, room, {
    id: guessMomentId(vote.id),
    kind: "guess",
    priority: 3,
    minMs: 0,
    until: (vote.deadlineAt ?? Date.now()) + 1000,
    payload: { question: "Who queued it?", deadlineAt: vote.deadlineAt ?? undefined, voteId: vote.id } satisfies TakeoverPayload,
  });
}

/**
 * A light "who queued this?" on an ordinary song: 20 seconds, phones get a pill rather than a sheet,
 * nobody earns or loses anything. The name was already visible in the queue before it started playing,
 * but the moment the round begins the song is switched to a real mystery pick (same flag, same leak
 * rule — no client is sent the adder) so "Added by" doesn't just sit there giving the answer away on
 * every screen for the round's length; it comes back the normal way when the round closes.
 */
export function startCasualGuess(io: Server, room: Room, item: QueueItem): void {
  if (isMystery(item) || !item.addedBy || item.source === "fallback" || openGuessVoteFor(room.id, item.id)) return;
  const adderId = item.addedBy;
  const present = [...getConnectedGuestIds(io, room.code)].filter((id) => id !== adderId && !getGuestById(id)?.kickedAt);
  const optionIds = pickGuessOptions(adderId, present);
  if (optionIds.length < 2) return;
  const options = optionIds.flatMap((id) => {
    const g = getGuestById(id);
    return g ? [{ id, label: g.nickname, emoji: g.emoji }] : [];
  });
  getVoteEngine().open({
    roomId: room.id,
    type: "guess",
    title: "Who queued this?",
    instruction: "Just for fun. Your first pick is final",
    options,
    durationMs: Math.min(QUICK_GUESS_SECONDS * 1000, item.durationMs),
    targetQueueItemId: item.id,
    meta: { queueItemId: item.id, adderId, optionIds, casual: true } satisfies GuessMeta as unknown as Record<string, unknown>,
  });
  markCasualMystery(item.id);
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
}

/** The song ended or was skipped: close its guess vote now (which reveals), or just reveal it. */
export function finishMysteryPick(io: Server, room: Room, itemId: string): void {
  const open = openGuessVoteFor(room.id, itemId);
  if (open) {
    getVoteEngine().closeNow(open.id);
    return;
  }
  const item = getQueueItemById(itemId);
  if (item && isMystery(item)) {
    markRevealed(item.id);
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
  }
}

function award(io: Server, room: Room, guestId: string, reason: "guess_right" | "stayed_hidden", itemId: string): boolean {
  try {
    const grant = apply({ roomId: room.id, guestId, delta: 1, reason, refId: itemId, cap: getRoomSettings(room.id).tokenCap });
    const payload: TokenUpdatePayload = { guestId, balance: grant.balance, delta: grant.delta, reason };
    emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
    return true;
  } catch (err) {
    if (err instanceof TokenCapExceededError) return false; // already at the cap; nothing is saved up
    throw err;
  }
}

function privateToast(io: Server, room: Room, guestId: string, message: string, big = false): void {
  const toast: ToastPayload = { id: crypto.randomUUID(), message, guestVisible: true, ...(big ? { big: true } : {}) };
  emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOAST, toast);
}

function onGuessClosed(vote: Vote, _result: VoteResult, room: Room): void {
  if (room.status !== "active") return;
  const io = getIO();
  const meta = metaOf(vote);
  const item = getQueueItemById(meta.queueItemId);
  const adder = getGuestById(meta.adderId);
  if (!item || !adder) return;

  if (meta.casual) {
    markRevealed(item.id); // hand "Added by" back to every screen now that the round is over
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
    const score = scoreGuessWho(meta.adderId, getBallots(vote.id), meta.optionIds);
    const toast: ToastPayload = {
      id: crypto.randomUUID(),
      emoji: "🕵️",
      message:
        score.totalGuessers === 0
          ? `${adder.nickname} queued that one`
          : `${adder.nickname} queued it: ${score.correctGuessers.length} of ${score.totalGuessers} guessed`,
    };
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, toast);
    return;
  }

  markRevealed(item.id);
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));

  const ballots = getBallots(vote.id).map((b) => ({ guestId: b.guestId, optionId: b.optionId }));
  const score = scoreGuessWho(meta.adderId, ballots, meta.optionIds);

  const rightSet = new Set(score.correctGuessers);
  for (const b of ballots) {
    if (b.guestId === meta.adderId) continue;
    const correct = rightSet.has(b.guestId);
    const got = correct ? award(io, room, b.guestId, "guess_right", item.id) : false;
    privateToast(io, room, b.guestId, correct ? "You guessed right! +1 🪙" : `Nope — it was ${adder.nickname}`, correct);
    const result: GuessResultPayload = { correct, adder: { nickname: adder.nickname, emoji: adder.emoji }, delta: got ? 1 : 0 };
    emitToGuest(io, room.code, b.guestId, SOCKET_EVENTS.GUESS_RESULT, result);
  }
  if (score.adderStayedHidden && award(io, room, meta.adderId, "stayed_hidden", item.id)) {
    privateToast(io, room, meta.adderId, "Nobody guessed you! +1 🪙 for staying hidden 🕵️", true);
  }

  const guesses = meta.optionIds.flatMap((id) => {
    const g = getGuestById(id);
    return g ? [{ id, name: g.nickname, emoji: g.emoji, percent: score.percents[id] ?? 0 }] : [];
  });
  endMoment(io, room, guessMomentId(vote.id));
  showMoment(io, room, {
    id: `reveal-${vote.id}`,
    kind: "reveal",
    priority: 2,
    minMs: REVEAL_HOLD_MS,
    until: Date.now() + REVEAL_HOLD_MS + 500,
    payload: {
      question: `It was ${adder.nickname}`,
      reveal: {
        name: adder.nickname,
        emoji: adder.emoji,
        trackName: item.trackName,
        artistName: item.artistName,
        guesses,
        nobodyGuessed: score.totalGuessers === 0,
      },
    } satisfies TakeoverPayload,
  });
}

export function initGuess(): void {
  registerVoteHandler("guess", {
    // The adder can look but can't vote for themselves.
    decorate(vote, guestId, option) {
      return metaOf(vote).adderId === guestId ? { ...option, disabledReason: "It's your pick" } : option;
    },
    validateBallot(vote, guestId) {
      return metaOf(vote).adderId === guestId ? "It's your pick" : null;
    },
    summarize(vote) {
      const adder = getGuestById(metaOf(vote).adderId);
      return adder ? `It was ${adder.nickname}` : undefined;
    },
    onClosed: onGuessClosed,
  });
}
