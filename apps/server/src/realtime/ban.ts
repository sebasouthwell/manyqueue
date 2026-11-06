import { forgetRemovedItem } from "./player-loop.js";
import crypto from "node:crypto";
import type { Server } from "socket.io";
import {
  BAN_RESULT_MS,
  BAN_VOTE_SECONDS,
  SOCKET_EVENTS,
  banCooldownLeftMs,
  banThreshold,
  type TakeoverPayload,
  type ToastPayload,
  type TokenUpdatePayload,
  type VoteResult,
} from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { getQueueItemById, refundQueueItem, removeQueuedItem, serializeQueue } from "../db/queue.js";
import { banTrack, isTrackBanned, lastBanCalledAt } from "../db/bans.js";
import { listOpenTimedVotes, setVoteMeta, type Vote } from "../db/votes.js";
import { getIO } from "./io-instance.js";
import { emitToGuest, getActiveGuestCount, roomChannel } from "./socket-server.js";
import { endMoment, showMoment } from "./moments.js";
import { maybeApplyFairOrder, maybeRecomputeApprovalLockAt } from "./queue-recompute.js";
import { recordAction } from "./action-log-broadcast.js";
import { forceSkipCurrent } from "./playback-control.js";
import { getVoteEngine, registerVoteHandler } from "./votes.js";
import { gameSpacing, songsFinished } from "./game-rules.js";

interface BanMeta {
  calledBy: string;
  queueItemId: string;
  trackUri: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  vetoed?: boolean;
  /** Songs finished when it began, for the spacing between games. */
  songIndex?: number;
}

const banMomentId = (voteId: string) => `ban-${voteId}`;
const metaOf = (vote: Vote) => vote.meta as unknown as BanMeta;

export function getRunningBan(roomId: string): Vote | undefined {
  return listOpenTimedVotes(undefined, roomId).find((v) => v.type === "ban");
}

/** How long until this guest may call another ban vote (0 = now). */
export function banCooldownFor(room: Room, guestId: string): number {
  return banCooldownLeftMs(lastBanCalledAt(room.id, guestId), getRoomSettings(room.id).banCooldownMin, Date.now());
}

export type CallBanResult =
  | { ok: true; voteId: string }
  | { ok: false; error: "cooldown" | "ban_running" | "game_spacing" | "invalid_target" | "already_banned"; retryAfterMs?: number };

/** A guest calls a ban vote on the playing song or one waiting in the queue. */
export function callBan(io: Server, room: Room, guestId: string, queueItemId: string): CallBanResult {
  const wait = banCooldownFor(room, guestId);
  if (wait > 0) return { ok: false, error: "cooldown", retryAfterMs: wait };
  if (getRunningBan(room.id)) return { ok: false, error: "ban_running" };
  // At most one game per song, and a song with no game between two games.
  if (!gameSpacing(room).ok) return { ok: false, error: "game_spacing" };

  const item = getQueueItemById(queueItemId);
  // A locked song is already in Spotify's own queue and can't be pulled back.
  if (!item || item.roomId !== room.id || !["playing", "queued", "pending"].includes(item.status)) {
    return { ok: false, error: "invalid_target" };
  }
  if (isTrackBanned(room.id, item.trackUri)) return { ok: false, error: "already_banned" };

  const meta: BanMeta = {
    calledBy: guestId,
    queueItemId: item.id,
    trackUri: item.trackUri,
    trackName: item.trackName,
    artistName: item.artistName,
    albumArtUrl: item.albumArtUrl,
    songIndex: songsFinished(room),
  };
  const vote = getVoteEngine().open({
    roomId: room.id,
    type: "ban",
    title: "Ban this song for the night?",
    instruction: "Ban it if it's really not landing",
    options: [
      { id: "yes", label: "Ban it" },
      { id: "no", label: "Keep it" },
    ],
    durationMs: BAN_VOTE_SECONDS * 1000,
    targetQueueItemId: item.id,
    meta: meta as unknown as Record<string, unknown>,
  });

  const active = getActiveGuestCount(io, room.code);
  const deadlineAt = vote.deadlineAt ?? Date.now();
  showMoment(io, room, {
    id: banMomentId(vote.id),
    kind: "ban",
    priority: 1,
    minMs: 5000,
    until: deadlineAt + 1500,
    payload: {
      question: "Ban this song for the night?",
      deadlineAt,
      instruction: "Vote on your phone",
      voteId: vote.id,
      ban: { threshold: banThreshold(active), active },
      choices: [{ id: "song", label: item.trackName, sublabel: item.artistName, artUrl: item.albumArtUrl }],
    } satisfies TakeoverPayload,
  });
  return { ok: true, voteId: vote.id };
}

/** Host only: end the running ban vote right now as "Host kept it". */
export function vetoBan(io: Server, room: Room, hostId: string): boolean {
  const vote = getRunningBan(room.id);
  if (!vote) return false;
  setVoteMeta(vote.id, { ...(vote.meta as object), vetoed: true });
  getVoteEngine().closeNow(vote.id, (computed): VoteResult => ({ ...computed, winnerOptionId: "no", outcome: "failed" }));
  recordAction(io, room, { actor: hostId, action: "veto", detail: `the ban on "${metaOf(vote).trackName}"` });
  return true;
}

function refundAdder(io: Server, room: Room, itemId: string): void {
  const item = getQueueItemById(itemId);
  if (!item?.addedBy) return;
  const newBalance = refundQueueItem(item, "refund_reject", getRoomSettings(room.id).tokenCap);
  if (newBalance === null) return;
  const payload: TokenUpdatePayload = { guestId: item.addedBy, balance: newBalance, delta: item.paid, reason: "refund_reject" };
  emitToGuest(io, room.code, item.addedBy, SOCKET_EVENTS.TOKEN_UPDATE, payload);
  const toast: ToastPayload = {
    id: crypto.randomUUID(),
    message: `The room banned "${item.trackName}", so your token is back`,
    guestVisible: true,
  };
  emitToGuest(io, room.code, item.addedBy, SOCKET_EVENTS.TOAST, toast);
}

function onBanClosed(vote: Vote, result: VoteResult, room: Room): void {
  if (room.status !== "active") return;
  const io = getIO();
  const meta = metaOf(vote);
  const passed = !meta.vetoed && result.outcome === "passed";
  const active = getActiveGuestCount(io, room.code);

  if (passed) {
    banTrack(room.id, meta.trackUri, vote.id);
    const item = getQueueItemById(meta.queueItemId);
    if (item?.status === "playing") {
      refundAdder(io, room, item.id);
      void forceSkipCurrent(room, "🚫 Banned by the room");
    } else if (item && (item.status === "queued" || item.status === "pending")) {
      // Refund first: the row is marked skipped straight after, and the refund only needs its cost.
      refundAdder(io, room, item.id);
      removeQueuedItem(item.id);
      forgetRemovedItem(room.code, item.id);
      maybeApplyFairOrder(room);
      maybeRecomputeApprovalLockAt(room);
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
    }
    recordAction(io, room, { actor: "system", action: "ban", detail: `"${meta.trackName}" by vote` });
  }

  const resultText = passed
    ? `🚫 ${meta.trackName} is banned for the night`
    : meta.vetoed
      ? "Host kept it"
      : "Not enough votes: it stays";
  endMoment(io, room, banMomentId(vote.id));
  showMoment(io, room, {
    id: `${banMomentId(vote.id)}-result`,
    kind: "ban",
    priority: 1,
    minMs: BAN_RESULT_MS,
    until: Date.now() + BAN_RESULT_MS,
    payload: {
      question: "Ban this song for the night?",
      voteId: vote.id,
      ban: { threshold: banThreshold(active), active },
      choices: [{ id: "song", label: meta.trackName, sublabel: meta.artistName, artUrl: meta.albumArtUrl }],
      ...(passed ? {} : { winnerChoiceId: "song" }),
      resultText,
    } satisfies TakeoverPayload,
  });
  const toast: ToastPayload = { id: crypto.randomUUID(), message: resultText, emoji: passed ? "🚫" : "🙌" };
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, toast);
}

export function initBans(): void {
  registerVoteHandler("ban", {
    summarize(vote, result) {
      const meta = metaOf(vote);
      if (meta.vetoed) return "Host kept it";
      return result.outcome === "passed" ? `${meta.trackName} is banned` : "Kept it";
    },
    onClosed: onBanClosed,
  });
}
