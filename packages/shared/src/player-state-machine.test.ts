import { describe, it, expect } from "vitest";
import {
  createInitialPlayerState,
  onPoll,
  START_RETRY_MS,
  type PlayerState,
  type PollResult,
  type QueueSnapshotItem,
  type PlayerAction,
} from "./player-state-machine.js";

const DEVICE_ID = "device-1";
const DEVICE_NAME = "Living Room Sonos";

function poll(overrides: Partial<PollResult>): PollResult {
  return {
    isPlayerAvailable: true,
    deviceId: DEVICE_ID,
    deviceName: DEVICE_NAME,
    isPlaying: true,
    trackUri: null,
    progressMs: 0,
    durationMs: 0,
    chosenDevicePresent: true,
    sampledAt: Date.now(),
    ...overrides,
  };
}

function step(state: PlayerState, p: PollResult, queue: QueueSnapshotItem[]) {
  return onPoll(state, p, queue);
}

function actionsOfType<T extends PlayerAction["type"]>(actions: PlayerAction[], type: T) {
  return actions.filter((a): a is Extract<PlayerAction, { type: T }> => a.type === type);
}

describe("player state machine", () => {
  it("takes over from Spotify's own autoplay as soon as the room has a song (no wait for that track to end)", () => {
    // The room ran dry (no fallback playlist) and Spotify carried on by itself: we're tracking its song.
    let state: PlayerState = { ...createInitialPlayerState(DEVICE_ID, DEVICE_NAME), currentTrackUri: "spotify:track:autoplay", isPlaying: true };
    // Still nothing of ours: leave Spotify alone.
    const idle = step(state, poll({ trackUri: "spotify:track:autoplay", progressMs: 30_000, durationMs: 200_000 }), []);
    expect(actionsOfType(idle.actions, "spotify:play")).toHaveLength(0);
    state = idle.state;
    // A guest adds a song: it starts now, mid-autoplay.
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:ours", durationMs: 200_000 }];
    const { state: next, actions } = step(state, poll({ trackUri: "spotify:track:autoplay", progressMs: 40_000, durationMs: 200_000 }), queue);
    expect(actionsOfType(actions, "spotify:play")).toEqual([{ type: "spotify:play", deviceId: DEVICE_ID, uri: "spotify:track:ours" }]);
    expect(next.lockedQueueItemId).toBe("q1");
  });

  it("doesn't restart the room's own song when Spotify is already playing it", () => {
    const state: PlayerState = { ...createInitialPlayerState(DEVICE_ID, DEVICE_NAME), currentTrackUri: "spotify:track:ours", isPlaying: true };
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:ours", durationMs: 200_000 }];
    const { actions } = step(state, poll({ trackUri: "spotify:track:ours", progressMs: 10_000, durationMs: 200_000 }), queue);
    expect(actionsOfType(actions, "spotify:play")).toHaveLength(0);
  });

  it("starts the first queued track when idle", () => {
    const state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 }];

    const { state: next, actions } = step(state, poll({ isPlaying: false }), queue);

    expect(actionsOfType(actions, "spotify:play")).toEqual([
      { type: "spotify:play", deviceId: DEVICE_ID, uri: "spotify:track:a" },
    ]);
    expect(next.lockedQueueItemId).toBe("q1");
    expect(next.expectedNextUri).toBe("spotify:track:a");
  });

  it("sends the start again when the speaker accepted it but never started", () => {
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 }];
    const t0 = 1_000_000;
    let { state } = step(createInitialPlayerState(DEVICE_ID, DEVICE_NAME), poll({ isPlaying: false, sampledAt: t0 }), queue);

    // Still silent 3s later: give the speaker time, don't spam it.
    const soon = step(state, poll({ isPlaying: false, sampledAt: t0 + 3_000 }), queue);
    expect(actionsOfType(soon.actions, "spotify:play")).toHaveLength(0);
    state = soon.state;

    // Still silent past the retry window: ask again.
    const later = step(state, poll({ isPlaying: false, sampledAt: t0 + START_RETRY_MS }), queue);
    expect(actionsOfType(later.actions, "spotify:play")).toEqual([
      { type: "spotify:play", deviceId: DEVICE_ID, uri: "spotify:track:a" },
    ]);
    expect(later.state.startAttemptedAt).toBe(t0 + START_RETRY_MS);
  });

  it("a start that took doesn't get retried", () => {
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 }];
    const t0 = 1_000_000;
    let { state } = step(createInitialPlayerState(DEVICE_ID, DEVICE_NAME), poll({ isPlaying: false, sampledAt: t0 }), queue);
    for (const dt of [3_000, 6_000]) {
      state = step(state, poll({ isPlaying: true, trackUri: "spotify:track:a", progressMs: dt, durationMs: 200_000, sampledAt: t0 + dt }), queue).state;
    }
    expect(state.currentQueueItemId).toBe("q1");
    expect(state.startAttemptedAt).toBeNull();
    // Paused by the host later on: that's a pause, not a failed start.
    const paused = step(state, poll({ isPlaying: false, trackUri: "spotify:track:a", progressMs: 7_000, durationMs: 200_000, sampledAt: t0 + 60_000 }), queue);
    expect(actionsOfType(paused.actions, "spotify:play")).toHaveLength(0);
  });

  it("the song we asked for confirms on its first sighting (a 9-second song can't wait for two polls)", () => {
    let state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    state = { ...state, lockedQueueItemId: "q1", expectedNextUri: "spotify:track:a" };
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:a", durationMs: 9_000 }];

    const { state: confirmed, actions } = step(
      state,
      poll({ isPlaying: true, trackUri: "spotify:track:a", progressMs: 1000, durationMs: 9_000 }),
      queue,
    );
    expect(actionsOfType(actions, "db:markPlaying")).toEqual([{ type: "db:markPlaying", queueItemId: "q1" }]);
    expect(confirmed.currentQueueItemId).toBe("q1");
    expect(confirmed.lockedQueueItemId).toBeNull();
  });

  it("a lagging poll: a track we didn't ask for still needs two sightings", () => {
    let state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    state = { ...state, currentQueueItemId: "q1", currentTrackUri: "spotify:track:a", isPlaying: true };
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 }];

    const { state: next, actions } = step(
      state,
      poll({ isPlaying: true, trackUri: "spotify:track:stale", progressMs: 1000, durationMs: 200_000 }),
      queue,
    );
    expect(actions.filter((a) => a.type.startsWith("db:") || a.type.startsWith("spotify:"))).toHaveLength(0);
    expect(next.currentQueueItemId).toBe("q1");
    expect(next.pendingTrackChange).toEqual({ uri: "spotify:track:stale", confirmations: 1 });
  });

  it("normal handoff: locks and queues the next track ~15s before the current one ends, then confirms it", () => {
    let state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    state = {
      ...state,
      currentQueueItemId: "q1",
      currentTrackUri: "spotify:track:a",
      progressMs: 190_000,
      durationMs: 200_000,
    };
    const queue: QueueSnapshotItem[] = [
      { id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 },
      { id: "q2", trackUri: "spotify:track:b", durationMs: 180_000 },
    ];

    const { state: locked, actions } = step(
      state,
      poll({ isPlaying: true, trackUri: "spotify:track:a", progressMs: 190_000, durationMs: 200_000 }),
      queue,
    );

    expect(actionsOfType(actions, "spotify:queue")).toEqual([
      { type: "spotify:queue", deviceId: DEVICE_ID, uri: "spotify:track:b" },
    ]);
    expect(actionsOfType(actions, "db:markLocked")).toEqual([
      { type: "db:markLocked", queueItemId: "q2" },
    ]);
    expect(locked.lockedQueueItemId).toBe("q2");
    expect(locked.expectedNextUri).toBe("spotify:track:b");

    // Track actually changes to the handed-off track: ours, so the first sighting confirms it.
    const { state: confirmed, actions: confirmActions } = step(
      locked,
      poll({ isPlaying: true, trackUri: "spotify:track:b", progressMs: 500, durationMs: 180_000 }),
      queue,
    );

    expect(actionsOfType(confirmActions, "db:markPlayed")).toEqual([
      { type: "db:markPlayed", queueItemId: "q1" },
    ]);
    expect(actionsOfType(confirmActions, "db:markPlaying")).toEqual([
      { type: "db:markPlaying", queueItemId: "q2" },
    ]);
    expect(confirmed.currentQueueItemId).toBe("q2");
    expect(confirmed.currentTrackUri).toBe("spotify:track:b");
  });

  it("a ghost track: an unexpected track shows up mid-handoff, gets forced back to the expected one", () => {
    let state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    state = {
      ...state,
      currentQueueItemId: "q1",
      currentTrackUri: "spotify:track:a",
      lockedQueueItemId: "q2",
      expectedNextUri: "spotify:track:b",
      progressMs: 195_000,
      durationMs: 200_000,
    };
    const queue: QueueSnapshotItem[] = [
      { id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 },
      { id: "q2", trackUri: "spotify:track:b", durationMs: 180_000 },
    ];

    // Something else entirely starts playing instead of the expected handoff track,
    // confirmed over 2 polls (a genuine ghost, not just a lagging poll).
    const afterFirst = step(
      state,
      poll({ isPlaying: true, trackUri: "spotify:track:ghost", progressMs: 500, durationMs: 90_000 }),
      queue,
    ).state;
    const { actions } = step(
      afterFirst,
      poll({ isPlaying: true, trackUri: "spotify:track:ghost", progressMs: 1500, durationMs: 90_000 }),
      queue,
    );

    // Forced explicitly back to the expected handoff track rather than trusting
    // Spotify's own /next to land on the right thing.
    expect(actionsOfType(actions, "spotify:play")).toEqual([
      { type: "spotify:play", deviceId: DEVICE_ID, uri: "spotify:track:b" },
    ]);
    // The ghost is not accepted as the new current track.
    expect(actionsOfType(actions, "db:markPlaying")).toHaveLength(0);
  });

  it("Spotify drifts to an unrecognized track (e.g. its own autoplay) while real queue items are waiting: redirected back to the queue instead of accepted", () => {
    let state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    state = {
      ...state,
      currentQueueItemId: "q1",
      currentTrackUri: "spotify:track:a",
      progressMs: 200_000,
      durationMs: 200_000,
    };
    // q1 has already ended in Spotify's world; q2 is queued and waiting, but nothing
    // was ever locked/expected (no handoff happened — e.g. this is the very last real
    // song and nothing was queued ahead of time).
    const queue: QueueSnapshotItem[] = [
      { id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 },
      { id: "q2", trackUri: "spotify:track:b", durationMs: 180_000 },
    ];

    const afterFirst = step(
      state,
      poll({ isPlaying: true, trackUri: "spotify:track:autoplay-pick", progressMs: 500, durationMs: 90_000 }),
      queue,
    ).state;
    const { state: next, actions } = step(
      afterFirst,
      poll({ isPlaying: true, trackUri: "spotify:track:autoplay-pick", progressMs: 1500, durationMs: 90_000 }),
      queue,
    );

    expect(actionsOfType(actions, "db:markPlayed")).toEqual([
      { type: "db:markPlayed", queueItemId: "q1" },
    ]);
    expect(actionsOfType(actions, "spotify:play")).toEqual([
      { type: "spotify:play", deviceId: DEVICE_ID, uri: "spotify:track:b" },
    ]);
    expect(next.lockedQueueItemId).toBe("q2");
    expect(next.expectedNextUri).toBe("spotify:track:b");
    // Not accepted as the new current track — we're actively steering back to q2.
    expect(next.currentTrackUri).not.toBe("spotify:track:autoplay-pick");
  });

  it("the device moving: playback transferred elsewhere is reported, not fought", () => {
    const state = { ...createInitialPlayerState(DEVICE_ID, DEVICE_NAME), isPlaying: true };
    const queue: QueueSnapshotItem[] = [];

    const { state: next, actions } = step(
      state,
      poll({ deviceId: "someone-else-phone", deviceName: "Kitchen iPhone" }),
      queue,
    );

    expect(next.speakerStatus).toBe("moved");
    expect(next.movedToDeviceName).toBe("Kitchen iPhone");
    expect(actionsOfType(actions, "broadcast:speaker")).toEqual([
      {
        type: "broadcast:speaker",
        payload: { status: "moved", movedToDeviceName: "Kitchen iPhone" },
      },
    ]);
    // We report it and back off — no automatic transfer-back action.
    expect(actions.some((a) => a.type === "spotify:play")).toBe(false);
  });

  it("the device vanishing: disconnects only after missing for more than 2 polls", () => {
    const state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    const queue: QueueSnapshotItem[] = [];
    const missingPoll = poll({ isPlayerAvailable: false, deviceId: null, chosenDevicePresent: false });

    const r1 = step(state, missingPoll, queue);
    expect(r1.state.speakerStatus).toBe("connected");

    const r2 = step(r1.state, missingPoll, queue);
    expect(r2.state.speakerStatus).toBe("connected");

    const r3 = step(r2.state, missingPoll, queue);
    expect(r3.state.speakerStatus).toBe("disconnected");
    expect(actionsOfType(r3.actions, "broadcast:speaker")).toEqual([
      { type: "broadcast:speaker", payload: { status: "disconnected", movedToDeviceName: null } },
    ]);

    // Recovers once the device is seen again.
    const r4 = step(r3.state, poll({ isPlaying: false }), queue);
    expect(r4.state.speakerStatus).toBe("connected");
  });

  it("a transient 204 mid-song (e.g. while the user scrubs the seek bar) does not reset progress or pause", () => {
    let state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    state = {
      ...state,
      isPlaying: true,
      currentQueueItemId: "q1",
      currentTrackUri: "spotify:track:a",
      progressMs: 90_000,
      durationMs: 200_000,
    };
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 }];

    // Spotify returns 204 for a single poll — within the grace period (limit is 2).
    const { state: next, actions } = step(
      state,
      poll({ isPlayerAvailable: false, deviceId: null, chosenDevicePresent: false }),
      queue,
    );

    expect(next.isPlaying).toBe(true);
    expect(next.progressMs).toBe(90_000);
    expect(next.durationMs).toBe(200_000);
    expect(next.currentTrackUri).toBe("spotify:track:a");
    expect(next.currentQueueItemId).toBe("q1");
    expect(actions).toHaveLength(0);

    // Real data returns on the next poll — picks up from where it actually is, no restart.
    const { state: recovered, actions: recoverActions } = step(
      next,
      poll({ isPlaying: true, trackUri: "spotify:track:a", progressMs: 93_000, durationMs: 200_000 }),
      queue,
    );
    expect(recovered.progressMs).toBe(93_000);
    expect(actionsOfType(recoverActions, "spotify:play")).toHaveLength(0);
  });

  it("a pause from the speaker: mirrors paused state and does not try to restart playback", () => {
    let state = createInitialPlayerState(DEVICE_ID, DEVICE_NAME);
    state = {
      ...state,
      isPlaying: true,
      currentQueueItemId: "q1",
      currentTrackUri: "spotify:track:a",
      progressMs: 50_000,
      durationMs: 200_000,
    };
    const queue: QueueSnapshotItem[] = [{ id: "q1", trackUri: "spotify:track:a", durationMs: 200_000 }];

    const { state: next, actions } = step(
      state,
      poll({ isPlaying: false, trackUri: "spotify:track:a", progressMs: 51_000, durationMs: 200_000 }),
      queue,
    );

    expect(next.isPlaying).toBe(false);
    expect(actionsOfType(actions, "spotify:play")).toHaveLength(0);
    expect(actionsOfType(actions, "broadcast:playback")).toEqual([
      {
        type: "broadcast:playback",
        payload: {
          isPlaying: false,
          trackUri: "spotify:track:a",
          progressMs: 51_000,
          durationMs: 200_000,
          sampledAt: expect.any(Number),
        },
      },
    ]);

    // A later poll still showing paused should not attempt to restart it either.
    const { actions: actions2 } = step(
      next,
      poll({ isPlaying: false, trackUri: "spotify:track:a", progressMs: 51_000, durationMs: 200_000 }),
      queue,
    );
    expect(actionsOfType(actions2, "spotify:play")).toHaveLength(0);
  });
});
