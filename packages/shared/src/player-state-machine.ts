// Pure state machine for the player loop (Block 7). No I/O — the caller executes the
// returned actions against Spotify/the DB/sockets and feeds the next poll back in.

export interface PlayerState {
  deviceId: string | null;
  deviceName: string | null;
  speakerStatus: "connected" | "disconnected" | "moved";
  movedToDeviceName: string | null;
  isPlaying: boolean;
  currentQueueItemId: string | null;
  currentTrackUri: string | null;
  progressMs: number;
  durationMs: number;
  lockedQueueItemId: string | null;
  expectedNextUri: string | null;
  missingDevicePolls: number;
  pendingTrackChange: { uri: string; confirmations: number } | null;
  /** When we last sent the "start from nothing" play. A speaker can accept it (204) and then do
   * nothing — desktop Spotify that's asleep does exactly that — so the lock it takes must expire. */
  startAttemptedAt: number | null;
}

export function createInitialPlayerState(deviceId: string, deviceName: string): PlayerState {
  return {
    deviceId,
    deviceName,
    speakerStatus: "connected",
    movedToDeviceName: null,
    isPlaying: false,
    currentQueueItemId: null,
    currentTrackUri: null,
    progressMs: 0,
    durationMs: 0,
    lockedQueueItemId: null,
    expectedNextUri: null,
    missingDevicePolls: 0,
    pendingTrackChange: null,
    startAttemptedAt: null,
  };
}

/** How long a start may go unanswered before we send the play again. */
export const START_RETRY_MS = 10_000;

export interface PollResult {
  /** false when GET /me/player returned 204 No Content. */
  isPlayerAvailable: boolean;
  deviceId: string | null;
  deviceName: string | null;
  isPlaying: boolean;
  trackUri: string | null;
  progressMs: number;
  durationMs: number;
  /** Whether the chosen device still appears in GET /me/player/devices this poll. */
  chosenDevicePresent: boolean;
  sampledAt: number;
}

export interface QueueSnapshotItem {
  id: string;
  trackUri: string;
  durationMs: number;
}

export type PlayerAction =
  | { type: "spotify:play"; deviceId: string; uri: string }
  | { type: "spotify:queue"; deviceId: string; uri: string }
  | { type: "spotify:next"; deviceId: string }
  | { type: "db:markPlayed"; queueItemId: string }
  | { type: "db:markPlaying"; queueItemId: string }
  | { type: "db:markLocked"; queueItemId: string }
  | {
      type: "broadcast:playback";
      payload: {
        isPlaying: boolean;
        trackUri: string | null;
        progressMs: number;
        durationMs: number;
        sampledAt: number;
      };
    }
  | {
      type: "broadcast:speaker";
      payload: {
        status: "connected" | "disconnected" | "moved";
        movedToDeviceName: string | null;
      };
    };

const HANDOFF_THRESHOLD_MS = 15_000;
const MISSING_DEVICE_POLL_LIMIT = 2;
const TRACK_CHANGE_CONFIRMATIONS_REQUIRED = 2;

export function onPoll(
  state: PlayerState,
  poll: PollResult,
  queue: QueueSnapshotItem[],
): { state: PlayerState; actions: PlayerAction[] } {
  const actions: PlayerAction[] = [];
  let next: PlayerState = { ...state };

  // --- Speaker presence / disconnect detection ---
  const deviceLooksMissing = !poll.isPlayerAvailable || !poll.chosenDevicePresent;
  if (deviceLooksMissing) {
    next.missingDevicePolls += 1;
  } else {
    next.missingDevicePolls = 0;
  }

  if (next.missingDevicePolls > MISSING_DEVICE_POLL_LIMIT) {
    if (next.speakerStatus !== "disconnected") {
      next.speakerStatus = "disconnected";
      actions.push({
        type: "broadcast:speaker",
        payload: { status: "disconnected", movedToDeviceName: null },
      });
    }
    // Nothing else to do this poll — we don't know what's really happening on the device.
    return { state: next, actions };
  }

  // Still within the grace period but this particular poll came back empty (a 204,
  // common mid-seek on some Connect devices). We have no reliable data this tick —
  // preserve the last known playback state rather than broadcasting a false reset to
  // progress 0 / paused / no track. Just wait for the next poll.
  if (!poll.isPlayerAvailable) {
    return { state: next, actions };
  }

  // --- Device moved (someone transferred playback elsewhere) ---
  if (poll.deviceId && poll.deviceId !== state.deviceId) {
    if (next.speakerStatus !== "moved" || next.movedToDeviceName !== poll.deviceName) {
      next.speakerStatus = "moved";
      next.movedToDeviceName = poll.deviceName;
      actions.push({
        type: "broadcast:speaker",
        payload: { status: "moved", movedToDeviceName: poll.deviceName },
      });
    }
    return { state: next, actions };
  }

  // --- Recovered from disconnected/moved back to our chosen device ---
  if (next.speakerStatus !== "connected") {
    next.speakerStatus = "connected";
    next.movedToDeviceName = null;
    actions.push({
      type: "broadcast:speaker",
      payload: { status: "connected", movedToDeviceName: null },
    });
  }

  next.progressMs = poll.progressMs;
  next.durationMs = poll.durationMs;

  // --- Pause mirroring: never fight a pause that came from the speaker/app itself ---
  if (state.isPlaying && !poll.isPlaying) {
    next.isPlaying = false;
    actions.push({
      type: "broadcast:playback",
      payload: {
        isPlaying: false,
        trackUri: poll.trackUri,
        progressMs: poll.progressMs,
        durationMs: poll.durationMs,
        sampledAt: poll.sampledAt,
      },
    });
    return { state: next, actions };
  }
  next.isPlaying = poll.isPlaying;

  // --- Track-change detection, debounced across 2 consecutive polls (Sonos lag) ---
  if (poll.trackUri && poll.trackUri !== state.currentTrackUri) {
    if (state.pendingTrackChange?.uri === poll.trackUri) {
      next.pendingTrackChange = {
        uri: poll.trackUri,
        confirmations: state.pendingTrackChange.confirmations + 1,
      };
    } else {
      next.pendingTrackChange = { uri: poll.trackUri, confirmations: 1 };
    }

    // The exact song we asked for can't be a laggy speaker's stale report, so it needs no second
    // sighting. Waiting for one is what made a 9-second song end unconfirmed and get replayed.
    const ours = poll.trackUri === state.expectedNextUri && state.lockedQueueItemId !== null;
    if (ours || next.pendingTrackChange.confirmations >= TRACK_CHANGE_CONFIRMATIONS_REQUIRED) {
      next = applyConfirmedTrackChange(next, poll.trackUri, queue, actions);
    }
  } else if (poll.trackUri === state.currentTrackUri) {
    next.pendingTrackChange = null;
  }

  // --- Starting: nothing of ours playing, we have a queue, and we're not already mid-handoff ---
  // "Nothing of ours" includes Spotify carrying on by itself (autoplay after the room ran dry, seen live
  // with no fallback playlist): without this the room's next song waited for that track to end, and only
  // re-picking the speaker got things moving. A paused speaker still counts as nothing playing.
  const foreignPlaying =
    poll.isPlaying &&
    !!poll.trackUri &&
    poll.trackUri !== state.expectedNextUri &&
    !queue.some((q) => q.trackUri === poll.trackUri);
  // The snapshot was taken before this poll: a song it just marked played is still in it, and must
  // never be started again (it would replay the moment the room ran dry).
  const playedNow = new Set(actions.flatMap((a) => (a.type === "db:markPlayed" ? [a.queueItemId] : [])));
  const startable = queue.filter((q) => !playedNow.has(q.id));
  if (
    (!poll.isPlaying || foreignPlaying) &&
    !next.currentQueueItemId &&
    (!next.lockedQueueItemId ||
      (next.startAttemptedAt !== null && poll.sampledAt - next.startAttemptedAt >= START_RETRY_MS)) &&
    startable.length > 0 &&
    next.speakerStatus === "connected"
  ) {
    // Before the retry, a start the speaker ignored kept its lock for good and the room stayed
    // silent until the host re-picked the speaker.
    const first = startable[0];
    actions.push({ type: "spotify:play", deviceId: state.deviceId!, uri: first.trackUri });
    next.lockedQueueItemId = first.id;
    next.expectedNextUri = first.trackUri;
    next.startAttemptedAt = poll.sampledAt;
  }

  // --- Handoff: lock and queue the next track ~15s before the current one ends ---
  const remainingMs = next.durationMs - next.progressMs;
  if (
    next.isPlaying &&
    next.currentQueueItemId &&
    !next.lockedQueueItemId &&
    next.durationMs > 0 &&
    remainingMs <= HANDOFF_THRESHOLD_MS
  ) {
    const currentIndex = queue.findIndex((q) => q.id === next.currentQueueItemId);
    const upNext = currentIndex >= 0 ? queue[currentIndex + 1] : queue[0];
    if (upNext) {
      actions.push({ type: "spotify:queue", deviceId: state.deviceId!, uri: upNext.trackUri });
      actions.push({ type: "db:markLocked", queueItemId: upNext.id });
      next.lockedQueueItemId = upNext.id;
      next.expectedNextUri = upNext.trackUri;
      next.startAttemptedAt = null;
    }
  }

  actions.push({
    type: "broadcast:playback",
    payload: {
      isPlaying: next.isPlaying,
      trackUri: next.currentTrackUri,
      progressMs: next.progressMs,
      durationMs: next.durationMs,
      sampledAt: poll.sampledAt,
    },
  });

  return { state: next, actions };
}

function applyConfirmedTrackChange(
  state: PlayerState,
  newUri: string,
  queue: QueueSnapshotItem[],
  actions: PlayerAction[],
): PlayerState {
  const next = { ...state, pendingTrackChange: null };

  if (newUri === state.expectedNextUri && state.lockedQueueItemId) {
    if (state.currentQueueItemId) {
      actions.push({ type: "db:markPlayed", queueItemId: state.currentQueueItemId });
    }
    actions.push({ type: "db:markPlaying", queueItemId: state.lockedQueueItemId });
    next.currentQueueItemId = state.lockedQueueItemId;
    next.currentTrackUri = newUri;
    next.lockedQueueItemId = null;
    next.expectedNextUri = null;
    next.startAttemptedAt = null;
    return next;
  }

  if (state.expectedNextUri) {
    // We were mid-handoff expecting a specific track and something else started instead
    // — a stale/ghost track. Force playback directly to the track we actually meant to
    // hand off to, rather than trusting Spotify's own /next to land on the right thing
    // (observed in practice: it can drift into autoplay instead of the queued track).
    actions.push({ type: "spotify:play", deviceId: state.deviceId!, uri: state.expectedNextUri });
    return next;
  }

  // No expectation at all — something started playing that we didn't cause (someone
  // changed the song from the Spotify app directly, or Spotify's own autoplay took
  // over after its ad-hoc queue ran dry). If we have real queue content waiting,
  // redirect back to it explicitly rather than passively going along with whatever
  // Spotify decided to play — ManyQueue's whole point is that the crowd's queue
  // drives playback, not Spotify's autoplay.
  const redirectTarget = queue.find((q) => q.id !== state.currentQueueItemId);
  if (redirectTarget) {
    if (state.currentQueueItemId) {
      actions.push({ type: "db:markPlayed", queueItemId: state.currentQueueItemId });
    }
    actions.push({
      type: "spotify:play",
      deviceId: state.deviceId!,
      uri: redirectTarget.trackUri,
    });
    next.currentQueueItemId = null;
    next.currentTrackUri = null;
    next.lockedQueueItemId = redirectTarget.id;
    next.expectedNextUri = redirectTarget.trackUri;
    return next;
  }

  // Nothing of ours to redirect to — just track what's actually playing.
  if (state.currentQueueItemId) {
    actions.push({ type: "db:markPlayed", queueItemId: state.currentQueueItemId });
  }
  next.currentQueueItemId = null;
  next.currentTrackUri = newUri;
  return next;
}
