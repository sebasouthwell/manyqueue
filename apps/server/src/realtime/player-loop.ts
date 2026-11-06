import crypto from "node:crypto";
import {
  onPoll,
  pollDelayMs,
  HANDOFF_WINDOW_MS,
  createInitialPlayerState,
  songRuleViolation,
  type PlayerState,
  type PollResult,
  type QueueSnapshotItem,
} from "@manyqueue/shared";
import { SOCKET_EVENTS } from "@manyqueue/shared";
import { getRoomByCode, type Room } from "../db/rooms.js";
import {
  getActiveQueueItems,
  getAllTrackUrisForRoom,
  getOnDeckItems,
  getPlayingItem,
  getQueueItemById,
  addQueueItem,
  markQueueItemLocked,
  markQueueItemPlaying,
  markQueueItemPlayed,
  autoApprovePendingItems,
  serializeQueue,
  markQueueItemSkipped,
  refundQueueItem,
} from "../db/queue.js";
import { emitToGuest, emitToStaff } from "./socket-server.js";
import { getRoomSettings } from "../db/settings.js";
import { refillOnDeck } from "./rotation-loop.js";
import { crowdTick } from "./crowd-pick.js";
import { vetoTick } from "./draft-veto.js";
import { maybeDefrost, isDefrostHolding } from "./defrost.js";
import { broadcastRotationState } from "./rotation-views.js";
import {
  getPlaybackState,
  listDevices,
  getSpotifyBlockedUntil,
  SpotifyAuthError,
  SpotifyQuotaError,
  playTrackOnDevice,
  SpotifyQueueBlockedError,
  SpotifyPlayUnconfirmedError,
  SpotifyTrackUnplayableError,
  isPlayableHere,
  sameSong,
  queueTrackOnDevice,
  skipToNext,
} from "../spotify.js";
import { pickRandomUnplayedFallbackTrack } from "../fallback-playlist.js";
import { getIO } from "./io-instance.js";
import { maybePayPassiveIncome } from "./passive-income.js";
import { maybeApplyFairOrder, maybeRecomputeApprovalLockAt } from "./queue-recompute.js";
import { broadcastAction } from "./action-log-broadcast.js";
import { finishMysteryPick } from "./guess.js";
import { onSongStarted } from "./song-events.js";
import { maybeRunNicknameBatch } from "./ai-nicknames.js";
import { evaluateLabels } from "./labels.js";
import { listBannedUris } from "../db/bans.js";
import { updateRoomVolume } from "./volume.js";
import { checkQueueDrift, broadcastQueueWarning } from "./queue-resync.js";

// The loop itself ticks every 3s for cheap local housekeeping (fallback top-up, auto-approvals);
// whether a tick actually asks Spotify what's playing is decided by `nextPollAt`, which comes from
// pollDelayMs: slow mid-song and while idle or paused, fast near a song's end. Polling every 3s
// around the clock is what used up Spotify's quota.
/** How often the loop wakes. Spotify is only asked when a poll is due (pollDelayMs), so this just has to
 * be fine enough for the 1s polls around a song change; at 3s those quietly became 3s polls. */
const TICK_MS = 1000;
/** Progress-bar broadcasts between polls: clients interpolate, so every 3s is plenty. */
const ESTIMATE_BROADCAST_MS = 3000;
const POLL_RETRY_MS = 6000;
const POKE_DELAY_MS = 600;
const DEVICE_CHECK_INTERVAL_MS = 30_000;
const lastDeviceCheck = new Map<string, number>();
const lastDevicePresent = new Map<string, boolean>();

interface RunningLoop {
  timer: ReturnType<typeof setInterval>;
  state: PlayerState;
  /** Earliest time the next Spotify poll may happen. */
  nextPollAt: number;
  /** When `state.progressMs` was measured (a poll, or our own change), to estimate progress since. */
  progressAt: number;
  /** A tick is still in flight; skip overlapping ones. */
  busy: boolean;
  lastEstimateAt: number;
}

const runningLoops = new Map<string, RunningLoop>();

const DRIFT_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const lastDriftCheckAt = new Map<string, number>();

// Pending items are visible in the queue/fair-order for display purposes but
// must never be eligible for the handoff/locking logic below until approved
// (host or silence) — they're filtered out of what the player state machine
// itself gets to see.
function queueSnapshot(roomId: string): QueueSnapshotItem[] {
  // Rotation mode hands off from on deck, not the shared active-status list — everything else about
  // the handoff/locking state machine below is the same either way (the Rotation-mode design R3).
  if (getRoomSettings(roomId).mode === "rotation") {
    return getOnDeckItems(roomId).map((item) => ({
      id: item.id,
      trackUri: item.trackUri,
      durationMs: item.durationMs,
    }));
  }
  return getActiveQueueItems(roomId)
    .filter((item) => item.status !== "pending")
    .map((item) => ({
      id: item.id,
      trackUri: item.trackUri,
      durationMs: item.durationMs,
    }));
}

/** Tops up the real queue with a random not-yet-used fallback track as soon as
 * nothing is waiting behind whatever's current/locked — not only once the queue
 * goes fully empty. Inserted as an ordinary "fallback"-sourced queue item, so the
 * existing handoff logic (~15s before the current track ends) picks it up and
 * hands off to Spotify gaplessly, exactly like a normal guest pick. Filling only
 * after the queue is already empty is too late: Spotify's device reaches the end
 * of the last real song with nothing queued and falls back to repeating it. */
function ensureFallbackFilled(room: Room): boolean {
  if (!room.fallbackPlaylistUri) return false;
  // Shared mode only. Rotation mode's house picks come from refillOnDeck(); running this too left one
  // stray "queued" house track nobody could play, used up a fallback track, and the next switch to
  // Shared mode would have put it ahead of the guests' songs.
  if (getRoomSettings(room.id).mode !== "shared") return false;
  const active = getActiveQueueItems(room.id);
  if (active.some((item) => item.status === "queued")) return false;

  const playlistId = room.fallbackPlaylistUri.replace("spotify:playlist:", "");
  const alreadyUsed = new Set([...getAllTrackUrisForRoom(room.id), ...listBannedUris(room.id)]);
  const rules = getRoomSettings(room.id);
  // House picks respect the room's song rules too — an explicit-free party
  // shouldn't get an explicit track just because the host, not a guest, chose the playlist.
  const track = pickRandomUnplayedFallbackTrack(
    playlistId,
    alreadyUsed,
    (t) => songRuleViolation(t, rules) === null,
  );
  if (!track) return false;

  addQueueItem({
    roomId: room.id,
    trackUri: track.uri,
    trackName: track.name,
    artistName: track.artistName,
    albumArtUrl: track.albumArtUrl,
        albumName: track.albumName,
    durationMs: track.durationMs,
    addedBy: null,
    source: "fallback",
  });
  return true;
}

/** Where the song is right now, by the server's own clock: the last measured position plus the time
 * that has passed since, while playing. Costs no Spotify call; polls only correct it (seeks, pauses). */
function estimateProgressMs(loop: RunningLoop, now: number): number {
  const st = loop.state;
  const elapsed = st.isPlaying ? now - loop.progressAt : 0;
  const estimate = st.progressMs + elapsed;
  return st.durationMs > 0 ? Math.min(st.durationMs, estimate) : estimate;
}

/** The server's best current estimate of where the playing song is, in ms — for a caller that needs a one-off
 * read (e.g. was this skip near the end?) rather than the ongoing socket broadcast. Null if the room has no
 * running loop. */
export function getEstimatedProgressMs(roomCode: string): number | null {
  const loop = runningLoops.get(roomCode);
  if (!loop) return null;
  return estimateProgressMs(loop, Date.now());
}

/** Tells every client the server's current idea of the playback position over the socket, so phones and
 * TVs (including ones that just joined) stay in step between Spotify polls. */
function broadcastEstimatedPlayback(roomCode: string, loop: RunningLoop): void {
  const st = loop.state;
  if (!st.currentTrackUri) return;
  const now = Date.now();
  getIO().to(`room:${roomCode}`).emit(SOCKET_EVENTS.PLAYBACK_UPDATE, {
    isPlaying: st.isPlaying,
    trackUri: st.currentTrackUri,
    progressMs: estimateProgressMs(loop, now),
    durationMs: st.durationMs,
    sampledAt: now,
  });
}

/** Decides when Spotify is next worth asking, from what we currently believe is playing. */
/** How long either side of a due song to poll every second (see POLL_AWAIT_MS). */
const AWAIT_WINDOW_MS = 15_000;
/** Draft the next song this much before the handoff window opens, so it's on deck when that poll lands. */
const DRAFT_LEAD_MS = 2_000;

/** The last unconfirmed play per room: what we asked for and what Spotify played instead. */
const unconfirmed = new Map<string, { asked: string; got: string }>();

/**
 * A jammed player (seen live on desktop Spotify): every play lands on nothing, and nothing remote clears
 * it, only restarting the Spotify app. After three "nothing is playing" answers in a row the loop stops
 * sending play requests, tells the host what to do, and waits until the device plays something again
 * (any track) or two minutes pass.
 */
const stalled = new Map<string, { misses: number; until: number; warned: boolean }>();
/** The last on-deck refill failure logged per room (so a standing one is logged once). */
const lastRefillError = new Map<string, string>();

/** A song Spotify can't play in the host's region: take it out (refunded) so the room moves on. */
function skipUnplayable(room: Room, uri: string): void {
  const item = [...getOnDeckItems(room.id), ...getActiveQueueItems(room.id)].find((i) => i.trackUri === uri && i.status !== "playing");
  if (!item) return;
  const settings = getRoomSettings(room.id);
  refundQueueItem(item, "refund_reject", settings.tokenCap);
  markQueueItemSkipped(item.id, false);
  const io = getIO();
  if (item.addedBy) {
    emitToGuest(io, room.code, item.addedBy, SOCKET_EVENTS.TOAST, {
      id: crypto.randomUUID(),
      message: `"${item.trackName}" isn't available on Spotify here, so it was skipped`,
      guestVisible: true,
    });
  }
  emitToStaff(io, room.code, SOCKET_EVENTS.TOAST, { id: crypto.randomUUID(), message: `Skipped "${item.trackName}": not available in this Spotify region` });
  try {
    refillOnDeck(room);
  } catch (err) {
    console.error(`[player-loop:${room.code}] refill after skipping an unplayable song failed:`, err);
  }
  io.to(`room:${room.code}`).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
  if (settings.mode === "rotation") broadcastRotationState(io, room);
}

function scheduleNextPoll(loop: RunningLoop, roomId: string): void {
  const st = loop.state;
  const now = Date.now();
  // Due now: we just asked Spotify to start it, or the current song should already have ended with the
  // next one handed off. Before the end, pollDelayMs's timed end poll covers it. Bounded in time so a
  // speaker that never plays isn't polled every second.
  const remaining = st.durationMs - estimateProgressMs(loop, now);
  const awaitingTrack =
    st.expectedNextUri !== null &&
    ((st.startAttemptedAt !== null && now - st.startAttemptedAt < AWAIT_WINDOW_MS) ||
      (st.currentQueueItemId !== null && st.durationMs > 0 && remaining <= 0 && remaining > -AWAIT_WINDOW_MS));
  loop.nextPollAt =
    Date.now() +
    pollDelayMs({
      isPlaying: st.isPlaying,
      progressMs: st.progressMs,
      durationMs: st.durationMs,
      hasWork: st.currentQueueItemId !== null || queueSnapshot(roomId).length > 0,
      pendingTrackChange: st.pendingTrackChange !== null,
      missingDevicePolls: st.missingDevicePolls,
      awaitingTrack,
    });
}

async function tick(roomCode: string): Promise<void> {
  const loop = runningLoops.get(roomCode);
  if (!loop || loop.busy) return;
  loop.busy = true;
  try {
    await runTick(roomCode, loop);
  } finally {
    loop.busy = false;
  }
}

async function runTick(roomCode: string, loop: RunningLoop): Promise<void> {
  const room = getRoomByCode(roomCode);
  if (!room || room.status !== "active" || !room.deviceId) {
    stopPlayerLoop(roomCode);
    return;
  }
  // Spotify is held paused for the defrost moment; it restarts the song itself when the ice shatters.
  if (isDefrostHolding(room.id)) return;

  const fallbackFilled = ensureFallbackFilled(room);
  // refillOnDeck() throws when Rotation mode genuinely has nothing left to draft and no fallback
  // playlist to fall back on (e.g. right after switching modes, before anyone's added a song) — real,
  // but it must never take the rest of this tick down with it (playback polling, progress, handoff all
  // still need to run) the way an uncaught throw here would.
  let onDeckRefilled = false;
  try {
    // Rotation drafts the next song only when it's due: nothing playing, or the current song inside
    // the handoff window (the handoff poll then queues it the same tick). Until then it stays fluid.
    const st = loop.state;
    const remaining = st.durationMs - estimateProgressMs(loop, Date.now());
    const nextDue = !st.currentQueueItemId || st.durationMs <= 0 || remaining <= HANDOFF_WINDOW_MS + DRAFT_LEAD_MS;
    // Crowd pick first: its winner, once the vote closes, is the next song, so the refill finds it there.
    let ballotChanged = false;
    try {
      ballotChanged = crowdTick(room, {
        playingItemId: st.currentQueueItemId,
        durationMs: st.durationMs,
        remainingMs: remaining,
        isPlaying: st.isPlaying,
      });
    } catch (err) {
      // Never let the vote block the draft: rotation order fills in at the handoff.
      console.error(`[player-loop:${roomCode}] crowd pick tick failed:`, err);
    }
    // Auto + veto: the host's 15s look at the pending draft, which commits at the refill below.
    let vetoChanged = false;
    try {
      vetoChanged = vetoTick(room, {
        playingItemId: st.currentQueueItemId,
        durationMs: st.durationMs,
        remainingMs: remaining,
        commitLeadMs: HANDOFF_WINDOW_MS + DRAFT_LEAD_MS,
      });
    } catch (err) {
      console.error(`[player-loop:${roomCode}] draft veto tick failed:`, err);
    }
    onDeckRefilled = refillOnDeck(room, undefined, { nextDue }) || ballotChanged || vetoChanged;
    lastRefillError.delete(roomCode);
  } catch (err) {
    // The same reason every 3s (no fallback playlist and nothing left to draft) is one log line, not
    // thousands: logged again only when the reason changes.
    const reason = err instanceof Error ? err.message : String(err);
    if (lastRefillError.get(roomCode) !== reason) {
      lastRefillError.set(roomCode, reason);
      console.error(`[player-loop:${roomCode}] on-deck refill failed:`, err);
    }
  }
  if (fallbackFilled || onDeckRefilled) {
    getIO()
      .to(`room:${roomCode}`)
      .emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
  }
  if (onDeckRefilled) broadcastRotationState(getIO(), room);

  // Up next can't play in this region (a song added before search hid those, or a fallback track): take it
  // out now, so it never sits locked in while the speaker idles and never reaches Spotify. Cached per
  // track, so this is one lookup per new song.
  for (let i = 0; i < 3; i++) {
    const next = getOnDeckItems(room.id).find((it) => it.status !== "playing");
    if (!next || (await isPlayableHere(room.hostId, next.trackUri).catch(() => null)) !== false) break;
    console.warn(`[player-loop:${roomCode}] up next ${next.trackUri} isn't playable in this region: skipping it`);
    skipUnplayable(room, next.trackUri);
  }

  const settings = getRoomSettings(room.id);
  if (settings.approvals) {
    const approved = autoApprovePendingItems(room.id);
    if (approved.length > 0) {
      getIO()
        .to(`room:${roomCode}`)
        .emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
      for (const item of approved) {
        broadcastAction(getIO(), room, { actor: "system", action: "auto_approve", detail: item.trackName });
      }
    }
  }

  // Every 10 minutes, look for songs queued directly in the Spotify app. Runs
  // detached so a slow Spotify call never delays the poll itself.
  const sinceCheck = lastDriftCheckAt.get(roomCode);
  if (sinceCheck === undefined) {
    lastDriftCheckAt.set(roomCode, Date.now());
  } else if (Date.now() - sinceCheck >= DRIFT_CHECK_INTERVAL_MS) {
    lastDriftCheckAt.set(roomCode, Date.now());
    checkQueueDrift(room)
      .then((foreignAhead) => broadcastQueueWarning(room, foreignAhead))
      .catch((err) => console.error(`[player-loop:${roomCode}] drift check failed:`, err));
  }

  // Spotify has told us to stay away: don't poll (every call would fail, and asking again only
  // prolongs the ban). The loop resumes by itself once the block time passes.
  if (getSpotifyBlockedUntil() !== null || Date.now() < loop.nextPollAt) {
    // No Spotify call this tick: the socket still carries the song's position from our own clock.
    if (Date.now() - loop.lastEstimateAt >= ESTIMATE_BROADCAST_MS) {
      loop.lastEstimateAt = Date.now();
      broadcastEstimatedPlayback(roomCode, loop);
    }
    return;
  }

  let playback;
  try {
    playback = await getPlaybackState(room.hostId);
  } catch (err) {
    loop.nextPollAt = Date.now() + POLL_RETRY_MS;
    // Transient Spotify/network error — skip this tick, try again next poll. A rate limit or a
    // refused login is already reported to the host, so it doesn't need a log line every 3s.
    if (!(err instanceof SpotifyQuotaError || err instanceof SpotifyAuthError)) {
      console.error(`[player-loop:${roomCode}] poll failed:`, err);
    }
    return;
  }

  // Is the chosen speaker still around? That list only changes when someone unplugs a
  // speaker, so ask every 15s rather than every 3s (it was half of all Spotify traffic).
  const checkedAt = lastDeviceCheck.get(roomCode);
  if (checkedAt === undefined || Date.now() - checkedAt >= DEVICE_CHECK_INTERVAL_MS) {
    try {
      const devices = await listDevices(room.hostId);
      lastDevicePresent.set(roomCode, devices.some((d) => d.id === room.deviceId));
      lastDeviceCheck.set(roomCode, Date.now());
    } catch (err) {
      console.error(`[player-loop:${roomCode}] device check failed:`, err);
    }
  }
  const chosenDevicePresent = lastDevicePresent.get(roomCode) ?? true;
  if (playback) updateRoomVolume(getIO(), roomCode, playback.volumePercent);

  const poll: PollResult = playback
    ? {
        isPlayerAvailable: true,
        deviceId: playback.deviceId,
        deviceName: playback.deviceName,
        isPlaying: playback.isPlaying,
        trackUri: playback.trackUri,
        progressMs: playback.progressMs,
        durationMs: playback.durationMs,
        chosenDevicePresent,
        sampledAt: Date.now(),
      }
    : {
        isPlayerAvailable: false,
        deviceId: null,
        deviceName: null,
        isPlaying: false,
        trackUri: null,
        progressMs: 0,
        durationMs: 0,
        chosenDevicePresent,
        sampledAt: Date.now(),
      };

  // Our handed-off song playing under another id (relinking: an album's copy vs a single's). Seen live on
  // every handoff of such a song: the state machine took it for a stranger's, sent play for our id and
  // restarted the song a few seconds in. Recognise it here, so it counts as ours on the first sighting.
  const expected = loop.state.expectedNextUri;
  if (
    poll.trackUri &&
    expected &&
    poll.trackUri !== expected &&
    poll.trackUri !== loop.state.currentTrackUri &&
    (await sameSong(room.hostId, poll.trackUri, expected).catch(() => false))
  ) {
    console.log(`[player-loop:${roomCode}] ${poll.trackUri} is our ${expected} under another id: taking it as ours`);
    loop.state = { ...loop.state, expectedNextUri: poll.trackUri };
  }

  const { state: nextState, actions } = onPoll(loop.state, poll, queueSnapshot(room.id));
  loop.state = nextState;
  loop.progressAt = poll.sampledAt;
  scheduleNextPoll(loop, room.id);

  const io = getIO();
  const channel = `room:${roomCode}`;

  for (const action of actions) {
    switch (action.type) {
      case "spotify:play": {
        const stall = stalled.get(roomCode);
        if (stall && stall.misses >= 3) {
          // Jammed: wait for a human (or the two minutes) instead of hammering it.
          if (poll.trackUri || Date.now() > stall.until) stalled.delete(roomCode);
          else break;
        }
        await playTrackOnDevice(room.hostId, action.deviceId, action.uri)
          .then((playing) => {
            unconfirmed.delete(roomCode);
            stalled.delete(roomCode);
            // Same song under a relinked id: expect that id, or the next poll takes it for a stranger's.
            if (playing !== action.uri && loop.state.expectedNextUri === action.uri) {
              loop.state = { ...loop.state, expectedNextUri: playing };
            }
          })
          .catch((err) => {
            if (err instanceof SpotifyTrackUnplayableError) {
              console.warn(`[player-loop:${roomCode}] ${err.uri} isn't playable in this region: skipping it`);
              skipUnplayable(room, err.uri);
              return;
            }
            if (err instanceof SpotifyPlayUnconfirmedError && err.playing === null) {
              const s = stalled.get(roomCode) ?? { misses: 0, until: 0, warned: false };
              s.misses++;
              if (s.misses >= 3) {
                s.until = Date.now() + 120_000;
                if (!s.warned) {
                  s.warned = true;
                  emitToStaff(getIO(), room.code, SOCKET_EVENTS.TOAST, {
                    id: crypto.randomUUID(),
                    message: `Spotify on ${room.deviceName ?? "the speaker"} has stopped responding. Restart Spotify there and press play on any song; the party picks up from there.`,
                  });
                }
              }
              stalled.set(roomCode, s);
            }
          // Too many songs queued in Spotify itself ahead of ours: the host's Resync banner explains it.
            if (err instanceof SpotifyQueueBlockedError) broadcastQueueWarning(room, err.foreignAhead);
            // Never loop on a substitute: when Spotify answers our request with the same other track twice
            // running, that track is what it plays for ours (a relinked copy the same-song check missed),
            // so expect it rather than asking again and restarting it every tick.
            if (err instanceof SpotifyPlayUnconfirmedError && err.playing) {
              const seen = unconfirmed.get(roomCode);
              if (seen && seen.asked === action.uri && seen.got === err.playing && loop.state.expectedNextUri === action.uri) {
                console.warn(`[player-loop:${roomCode}] Spotify plays ${err.playing} for ${action.uri} twice running: taking it as ours`);
                loop.state = { ...loop.state, expectedNextUri: err.playing };
                unconfirmed.delete(roomCode);
              } else {
                unconfirmed.set(roomCode, { asked: action.uri, got: err.playing });
              }
            }
            console.error(`[player-loop:${roomCode}] play failed:`, err);
          });
        break;
      }
      case "spotify:queue":
        await queueTrackOnDevice(room.hostId, action.deviceId, action.uri).catch((err) => {
          if (err instanceof SpotifyTrackUnplayableError) return skipUnplayable(room, err.uri);
          console.error(`[player-loop:${roomCode}] queue failed:`, err);
        });
        break;
      case "spotify:next":
        await skipToNext(room.hostId, action.deviceId).catch((err) =>
          console.error(`[player-loop:${roomCode}] skip failed:`, err),
        );
        break;
      case "db:markLocked":
        markQueueItemLocked(action.queueItemId);
        io.to(channel).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
        break;
      case "db:markPlaying":
        markQueueItemPlaying(action.queueItemId);
        io.to(channel).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
        {
          const started = getQueueItemById(action.queueItemId);
          // November's first Mariah: the TV ices over first (and shows any dedication itself).
          if (started) onSongStarted(io, room, started, Math.random, { skipDedication: maybeDefrost(io, room, started) });
        }
        break;
      case "db:markPlayed":
        markQueueItemPlayed(action.queueItemId);
        finishMysteryPick(io, room, action.queueItemId);
        maybeApplyFairOrder(room);
        maybeRecomputeApprovalLockAt(room);
        io.to(channel).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
        maybePayPassiveIncome(io, room);
        maybeRunNicknameBatch(io, room);
        evaluateLabels(io, room);
        break;
      case "broadcast:playback":
        io.to(channel).emit(SOCKET_EVENTS.PLAYBACK_UPDATE, action.payload);
        break;
      case "broadcast:speaker":
        io.to(channel).emit(SOCKET_EVENTS.SPEAKER_STATUS, action.payload);
        break;
    }
  }
}

export function startPlayerLoop(roomCode: string, deviceId: string, deviceName: string): void {
  const existing = runningLoops.get(roomCode);
  if (existing) clearInterval(existing.timer);

  let state = createInitialPlayerState(deviceId, deviceName);

  // The (re)started loop's in-memory state otherwise has no memory of what's
  // already playing — e.g. after a server restart, a code hot-reload, or the
  // host re-picking the same device. Without this, the next poll's "nothing is
  // playing yet" starting branch would force-restart whatever the DB still marks
  // as status:"playing" from position 0, even though Spotify itself never
  // stopped. Reconcile with the DB up front so that poll is a no-op instead.
  const room = getRoomByCode(roomCode);
  if (room) {
    const playing = getPlayingItem(room.id);
    if (playing) {
      state = { ...state, currentQueueItemId: playing.id, currentTrackUri: playing.trackUri };
    }
  }

  const timer = setInterval(() => {
    tick(roomCode).catch((err) => console.error(`[player-loop:${roomCode}] tick error:`, err));
  }, TICK_MS);

  runningLoops.set(roomCode, { timer, state, nextPollAt: 0, progressAt: Date.now(), busy: false, lastEstimateAt: 0 });
  tick(roomCode).catch((err) => console.error(`[player-loop:${roomCode}] initial tick error:`, err));
}

/**
 * Called after something outside the normal handoff flow changes the current track
 * (e.g. a crowd skip vote forcing the next track directly). Realigns the in-memory
 * state so the next poll doesn't try to re-mark the old item or treat the new one as
 * an unexpected ghost.
 */
export function syncCurrentAfterExternalChange(
  roomCode: string,
  queueItemId: string | null,
  trackUri: string | null,
  durationMs = 0,
): void {
  const loop = runningLoops.get(roomCode);
  if (!loop) return;
  // We just told Spotify to play this track, so we already know what is playing and from where:
  // no need to ask. The next poll comes from the normal schedule.
  loop.state = {
    ...loop.state,
    currentQueueItemId: queueItemId,
    currentTrackUri: trackUri,
    isPlaying: queueItemId !== null,
    lockedQueueItemId: null,
    expectedNextUri: null,
    pendingTrackChange: null,
    startAttemptedAt: null,
    progressMs: 0,
    durationMs,
  };
  loop.progressAt = Date.now();
  const room = getRoomByCode(roomCode);
  if (room) scheduleNextPoll(loop, room.id);
}

/**
 * The host (or someone with the permission) paused or resumed through us and Spotify accepted it, so
 * the new state is known without polling: update it, tell everyone, and keep the progress bar honest
 * by folding in the time that passed since the last measurement.
 */
export function applyLocalPlaybackChange(roomCode: string, isPlaying: boolean): void {
  const loop = runningLoops.get(roomCode);
  if (!loop) return;
  const now = Date.now();
  const st = loop.state;
  const progressMs = estimateProgressMs(loop, now);
  loop.state = { ...st, isPlaying, progressMs };
  loop.progressAt = now;
  getIO().to(`room:${roomCode}`).emit(SOCKET_EVENTS.PLAYBACK_UPDATE, {
    isPlaying,
    trackUri: st.currentTrackUri,
    progressMs,
    durationMs: st.durationMs,
    sampledAt: now,
  });
  const room = getRoomByCode(roomCode);
  if (room) scheduleNextPoll(loop, room.id);
}

/** Something changed that we can't know locally (e.g. one of our requests to Spotify failed): poll
 * again soon instead of waiting out the slow mid-song schedule. */
export function pokePlayerLoop(roomCode: string): void {
  const loop = runningLoops.get(roomCode);
  if (!loop) return;
  loop.nextPollAt = Math.min(loop.nextPollAt, Date.now() + POKE_DELAY_MS);
}

/**
 * A song was removed from the room after the loop had already claimed it (the first start of a night
 * claims its song without marking it in the database, so it stays removable). Forget it: otherwise the
 * loop kept treating it as the room's song and it played on as a ghost (seen live). If Spotify is
 * already playing it, it's now a stranger's song, and the room's next one takes over at the next poll.
 */
export function forgetRemovedItem(roomCode: string, itemId: string): void {
  const loop = runningLoops.get(roomCode);
  if (!loop) return;
  const st = loop.state;
  if (st.lockedQueueItemId === itemId) {
    loop.state = { ...st, lockedQueueItemId: null, expectedNextUri: null, startAttemptedAt: null };
  }
  if (loop.state.currentQueueItemId === itemId) {
    loop.state = { ...loop.state, currentQueueItemId: null };
  }
  pokePlayerLoop(roomCode);
}

export function stopPlayerLoop(roomCode: string): void {
  const loop = runningLoops.get(roomCode);
  if (!loop) return;
  clearInterval(loop.timer);
  lastDriftCheckAt.delete(roomCode);
  runningLoops.delete(roomCode);
}

export function isPlayerLoopRunning(roomCode: string): boolean {
  return runningLoops.has(roomCode);
}
