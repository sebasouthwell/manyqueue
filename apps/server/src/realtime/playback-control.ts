import { isNearEndSkip, SOCKET_EVENTS } from "@manyqueue/shared";
import { getRoomSettings } from "../db/settings.js";
import type { Room } from "../db/rooms.js";
import {
  getActiveQueueItems,
  getOnDeckItems,
  markQueueItemSkipped,
  markQueueItemPlaying,
  getQueueItemById,
  serializeQueue,
} from "../db/queue.js";
import { skipToNext, playTrackOnDevice, SpotifyQueueBlockedError } from "../spotify.js";
import { broadcastQueueWarning } from "./queue-resync.js";
import { refillOnDeck } from "./rotation-loop.js";
import { settleBallot } from "./crowd-pick.js";
import { broadcastRotationState } from "./rotation-views.js";
import { getIO } from "./io-instance.js";
import { roomChannel } from "./socket-server.js";
import { getEstimatedProgressMs, syncCurrentAfterExternalChange } from "./player-loop.js";
import { maybePayPassiveIncome } from "./passive-income.js";
import { maybeApplyFairOrder, maybeRecomputeApprovalLockAt } from "./queue-recompute.js";
import { finishMysteryPick } from "./guess.js";
import { onSongStarted } from "./song-events.js";
import { maybeRunNicknameBatch } from "./ai-nicknames.js";
import { evaluateLabels } from "./labels.js";

/**
 * Marks the currently playing item skipped and explicitly plays the next real
 * queue item directly (not Spotify's bare /next — see Block 9/10's notes on why
 * that can drift into autoplay instead of landing on what we actually want).
 * Shared by the crowd skip-vote route and the host's manual skip button.
 */
export async function forceSkipCurrent(room: Room, toastMessage: string): Promise<boolean> {
  // Rotation mode plays from on deck, not the Shared-mode list. Reading the Shared list there found no
  // "next", so a skip fell through to Spotify's own /next: Spotify's autoplay played for ~15s until the
  // player loop noticed and redirected, and Skip did nothing in the meantime.
  const rotation = getRoomSettings(room.id).mode === "rotation";
  // Rotation drafts at the last moment, so mid-song there's usually no next song on deck yet: a skip is
  // that moment, so draft it now.
  if (rotation) {
    try {
      // Crowd pick: a skip ends the vote early; the votes so far decide (rotation order if none).
      settleBallot(room);
      refillOnDeck(room, undefined, { nextDue: true });
    } catch (err) {
      console.error(`[playback-control:${room.code}] draft before skip failed:`, err);
    }
  }
  const active = rotation ? getOnDeckItems(room.id) : getActiveQueueItems(room.id);
  const current = active.find((item) => item.status === "playing");
  if (!current) return false;

  // Reaching for the next track right at the end isn't the same as cutting the song off — still a skip
  // (history, the activity log, a ban still say so), just one skip-counting stats leave out.
  const progressMs = getEstimatedProgressMs(room.code) ?? 0;
  markQueueItemSkipped(current.id, isNearEndSkip(progressMs, current.durationMs));
  finishMysteryPick(getIO(), room, current.id);
  // Never hand a still-pending (unapproved) item to Spotify.
  const next = active.find((item) => item.id !== current.id && item.status !== "pending");
  const io = getIO();
  maybePayPassiveIncome(io, room);

  // What Spotify actually reports for `next`: a relinked id for the same song, sometimes.
  let playingUri = next?.trackUri ?? null;
  if (room.deviceId) {
    if (next) {
      await playTrackOnDevice(room.hostId, room.deviceId, next.trackUri, { alreadyQueued: next.status === "locked" })
        .then((playing) => {
          playingUri = playing;
        })
        .catch((err) => {
        if (err instanceof SpotifyQueueBlockedError) broadcastQueueWarning(room, err.foreignAhead);
        console.error(`[playback-control:${room.code}] failed to play next track after skip:`, err);
      });
    } else {
      await skipToNext(room.hostId, room.deviceId).catch((err) =>
        console.error(`[playback-control:${room.code}] failed to skip with empty queue:`, err),
      );
    }
  }

  if (next) {
    markQueueItemPlaying(next.id);
    syncCurrentAfterExternalChange(room.code, next.id, playingUri ?? next.trackUri, next.durationMs);
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.PLAYBACK_UPDATE, {
      isPlaying: true,
      trackUri: next.trackUri,
      progressMs: 0,
      durationMs: next.durationMs,
      sampledAt: Date.now(),
    });
    // A song that starts by skip is a song starting like any other: its dedication splash, mystery-pick
    // guess vote and auto-contest all belong to it (only the natural handoff used to trigger them).
    const started = getQueueItemById(next.id);
    if (started) onSongStarted(io, room, started);
  } else {
    syncCurrentAfterExternalChange(room.code, null, null);
  }

  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, {
    id: crypto.randomUUID(),
    message: toastMessage,
  });

  // Reordering happens after "what plays next" is already decided and sent
  // to Spotify — fairOrder only touches queued items, but running it earlier
  // risks the broadcast disagreeing with what's actually about to play.
  maybeApplyFairOrder(room);
  maybeRecomputeApprovalLockAt(room);
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
  if (rotation) broadcastRotationState(io, room);
  maybeRunNicknameBatch(io, room);
  evaluateLabels(io, room);

  return true;
}
