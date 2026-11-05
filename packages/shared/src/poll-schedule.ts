/**
 * How long to wait before asking Spotify what's playing. Spotify's player API has
 * a hard quota, and polling it every 3 seconds around the clock is what tripped it.
 * Most of a song is uneventful (its length is known, and clients interpolate the
 * progress bar themselves), so poll slowly mid-song and at the exact moments
 * something can happen: the handoff and the predicted end.
 */
export const POLL_FAST_MS = 3_000;
export const POLL_MID_SONG_MAX_MS = 15_000;
export const POLL_PAUSED_MS = 8_000;
export const POLL_IDLE_MS = 20_000;
/** While a song we asked for is due to start: catch it within a second. A 9-second song was over
 * before the 8s "paused" poll (and the two 3s confirming polls) ever saw it, so the room replayed it. */
export const POLL_AWAIT_MS = 1_000;
/** The handoff queues the next song once a song has this long left (player-state-machine). */
export const HANDOFF_WINDOW_MS = 15_000;
/** Where the handoff poll lands: just inside that window, so one poll is enough to queue the next. */
export const HANDOFF_POLL_AT_MS = 14_000;
/** The end poll lands this long after the song should have finished: Spotify's state trails a change. */
export const END_GRACE_MS = 1_000;

export interface PollScheduleInput {
  isPlaying: boolean;
  /** Progress at the moment of the last poll. */
  progressMs: number;
  durationMs: number;
  /** Something is playing, or waiting to play. False means the room is idle. */
  hasWork: boolean;
  /** A track change is waiting for confirming polls. */
  pendingTrackChange: boolean;
  /** The speaker went missing and we're counting polls before declaring it gone. */
  missingDevicePolls: number;
  /** A song we asked for (a start, a redirect or the handoff) is due right now. The caller bounds this
   * in time, so a speaker that never starts doesn't hold the loop at one poll a second. */
  awaitingTrack?: boolean;
}

export function pollDelayMs(s: PollScheduleInput): number {
  if (s.awaitingTrack) return POLL_AWAIT_MS;
  // Anything that counts polls (confirming a change, a missing speaker) needs them quickly.
  if (s.pendingTrackChange || s.missingDevicePolls > 0) return POLL_FAST_MS;
  if (!s.hasWork) return POLL_IDLE_MS;
  if (!s.isPlaying) return POLL_PAUSED_MS;
  if (s.durationMs <= 0) return POLL_FAST_MS;

  // Polls follow the song: its length is known, so ask only where something happens. One poll just
  // inside the handoff window (queues the next song), then one just after the song should have ended
  // (sees the change). A 3-minute song and a 9-second one each cost what they need, no more.
  const remaining = s.durationMs - s.progressMs;
  if (remaining <= HANDOFF_WINDOW_MS) return Math.max(POLL_AWAIT_MS, remaining + END_GRACE_MS);
  return Math.min(POLL_MID_SONG_MAX_MS, remaining - HANDOFF_POLL_AT_MS);
}
