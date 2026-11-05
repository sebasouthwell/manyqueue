import {
  SOCKET_EVENTS,
  banThreshold,
  type VoteClosedPayload,
  type VoteOpenedPayload,
  type VoteOptionView,
  type VoteResult,
  type VoteType,
} from "@manyqueue/shared";
import { getRoomById, type Room } from "../db/rooms.js";
import { getBallot, listOpenTimedVotes, type Vote } from "../db/votes.js";
import { getIO } from "./io-instance.js";
import {
  emitToGuest,
  getActiveGuestCount,
  getConnectedGuestIds,
  roomChannel,
  setActiveVotesProvider,
} from "./socket-server.js";
import { createVoteEngine, type VoteEngine } from "./vote-engine.js";

/** What a game (contest, ban, guess…) plugs into the shared engine. */
export interface VoteTypeHandler {
  /** Per-guest tweaks to an option, e.g. disabledReason "Your song". */
  decorate?(vote: Vote, guestId: string, option: VoteOptionView): VoteOptionView;
  /** A reason to refuse this guest's ballot, or null. */
  validateBallot?(vote: Vote, guestId: string, optionId: string): string | null;
  /** The one line phones show for the 2s result hold. */
  summarize?(vote: Vote, result: VoteResult): string | undefined;
  /** Act on the outcome (move a song, ban a track, reveal a name…). */
  onClosed?(vote: Vote, result: VoteResult, room: Room): void;
}

const handlers: Partial<Record<VoteType, VoteTypeHandler>> = {};

// Set by realtime/games.ts at startup (they import each other otherwise): tells the
// host and co-hosts' live game card that something changed.
let gamesNotifier: ((room: Room) => void) | null = null;
export function setGamesNotifier(fn: (room: Room) => void): void {
  gamesNotifier = fn;
}
export function notifyGames(room: Room): void {
  gamesNotifier?.(room);
}

export function registerVoteHandler(type: VoteType, handler: VoteTypeHandler): void {
  handlers[type] = handler;
}

function roomOf(vote: Vote): Room | undefined {
  return getRoomById(vote.roomId);
}

export function voteOpenedPayload(vote: Vote, guestId?: string): VoteOpenedPayload {
  const handler = handlers[vote.type];
  const options = (vote.options ?? []).map((o): VoteOptionView =>
    guestId && handler?.decorate ? handler.decorate(vote, guestId, o) : o,
  );
  const extras: Partial<VoteOpenedPayload> = {};
  if (vote.type === "ban") {
    const room = getRoomById(vote.roomId);
    const active = room ? getActiveGuestCount(getIO(), room.code) : 0;
    const meta = (vote.meta ?? {}) as { trackName?: string; artistName?: string; albumArtUrl?: string | null };
    extras.threshold = banThreshold(active);
    extras.active = active;
    extras.target = { name: meta.trackName ?? "", artist: meta.artistName ?? "", albumArtUrl: meta.albumArtUrl ?? null };
  }
  if (vote.type === "guess" && (vote.meta as { casual?: boolean } | null)?.casual) extras.casual = true;
  return {
    ...extras,
    id: vote.id,
    type: vote.type,
    title: vote.title ?? "",
    ...(vote.instruction ? { instruction: vote.instruction } : {}),
    options,
    deadlineAt: vote.deadlineAt ?? 0,
    ...(guestId ? { myOptionId: getBallot(vote.id, guestId)?.optionId ?? null } : {}),
  };
}

/** The votes still open for a room, as one guest (or nobody in particular) sees them. */
export function activeVotesFor(room: Room, guestId?: string): VoteOpenedPayload[] {
  const now = Date.now();
  return listOpenTimedVotes(undefined, room.id)
    .filter((v) => (v.deadlineAt ?? 0) > now)
    .map((v) => voteOpenedPayload(v, guestId));
}

let engine: VoteEngine | null = null;

export function getVoteEngine(): VoteEngine {
  if (engine) return engine;
  engine = createVoteEngine({
    activeCount(roomId) {
      const room = getRoomById(roomId);
      return room ? getActiveGuestCount(getIO(), room.code) : 0;
    },
    onOpened(vote) {
      const room = roomOf(vote);
      if (!room) return;
      const io = getIO();
      for (const guestId of getConnectedGuestIds(io, room.code)) {
        emitToGuest(io, room.code, guestId, SOCKET_EVENTS.VOTE_OPENED, voteOpenedPayload(vote, guestId));
      }
      notifyGames(room);
    },
    onTally(vote, counts) {
      const room = roomOf(vote);
      if (room) notifyGames(room);
      // A guess vote's running count would let the room narrow down the adder.
      if (vote.type === "guess") return;
      if (room) getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.VOTE_TALLY, counts);
    },
    onClosed(vote, result) {
      const room = roomOf(vote);
      if (!room) return;
      const handler = handlers[vote.type];
      const winner = (vote.options ?? []).find((o) => o.id === result.winnerOptionId);
      const payload: VoteClosedPayload = {
        id: vote.id,
        winnerOptionId: result.winnerOptionId,
        summary: handler?.summarize?.(vote, result) ?? (winner ? `${winner.label} wins` : undefined),
        closedAt: Date.now(),
      };
      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.VOTE_CLOSED, payload);
      handler?.onClosed?.(vote, result, room);
      notifyGames(room);
    },
    validateBallot(vote, guestId, optionId) {
      return handlers[vote.type]?.validateBallot?.(vote, guestId, optionId) ?? null;
    },
  });
  return engine;
}

/** Call once at startup, after the socket server exists: lets snapshots list
 * open votes and re-arms the timers of any vote a restart interrupted. */
export function initVotes(): number {
  setActiveVotesProvider(activeVotesFor);
  return getVoteEngine().rearm();
}
