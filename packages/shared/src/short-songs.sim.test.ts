import { describe, it, expect } from "vitest";
import { createInitialPlayerState, onPoll, type QueueSnapshotItem } from "./player-state-machine.js";
import { pollDelayMs } from "./poll-schedule.js";

/**
 * End-to-end over time: the real state machine and the real poll schedule against a pretend Spotify
 * (plays its queue in order, then autoplay). Catches what single-step tests can't: a song that ends
 * between polls, a replay loop, or polls piling up.
 */
function simulate(durations: number[]) {
  const songs: QueueSnapshotItem[] = durations.map((d, i) => ({ id: `q${i}`, trackUri: `spotify:track:s${i}`, durationMs: d }));
  const dur = new Map<string, number>(songs.map((s) => [s.trackUri, s.durationMs]));
  const sp = { current: null as string | null, startedAt: 0, queue: [] as string[], auto: 0 };
  const room = [...songs];
  const startedOrder: string[] = [];
  let plays = 0;
  let polls = 0;
  let state = createInitialPlayerState("pc", "PC");
  let t = 0;
  let lastPollAt = 0;
  const end = durations.reduce((a, b) => a + b, 0) + 60_000;

  const advance = () => {
    while (sp.current) {
      const d = dur.get(sp.current) ?? 200_000;
      if (t < sp.startedAt + d) break;
      sp.startedAt += d;
      const next = sp.queue.shift() ?? `spotify:track:auto${sp.auto++}`;
      sp.current = next;
    }
  };

  while (t < end && room.length > 0) {
    advance();
    polls++;
    const progress = sp.current ? t - sp.startedAt : 0;
    const { state: nextState, actions } = onPoll(
      state,
      {
        isPlayerAvailable: true,
        deviceId: "pc",
        deviceName: "PC",
        isPlaying: sp.current !== null,
        trackUri: sp.current,
        progressMs: progress,
        durationMs: sp.current ? dur.get(sp.current) ?? 200_000 : 0,
        chosenDevicePresent: true,
        sampledAt: t,
      },
      room,
    );
    state = nextState;
    lastPollAt = t;
    for (const a of actions) {
      if (a.type === "spotify:play") {
        plays++;
        sp.current = a.uri;
        sp.startedAt = t;
      }
      if (a.type === "spotify:queue") sp.queue.push(a.uri);
      if (a.type === "db:markPlaying") startedOrder.push(a.queueItemId);
      if (a.type === "db:markPlayed") room.splice(room.findIndex((r) => r.id === a.queueItemId), 1);
    }
    // Same "a song is due" rule as the player loop's scheduleNextPoll.
    const remaining = state.durationMs - (state.progressMs + (t - lastPollAt));
    const awaitingTrack =
      state.expectedNextUri !== null &&
      ((state.startAttemptedAt !== null && t - state.startAttemptedAt < 15_000) ||
        (state.currentQueueItemId !== null && state.durationMs > 0 && remaining <= 0 && remaining > -15_000));
    t += pollDelayMs({
      isPlaying: state.isPlaying,
      progressMs: state.progressMs,
      durationMs: state.durationMs,
      hasWork: state.currentQueueItemId !== null || room.length > 0,
      pendingTrackChange: state.pendingTrackChange !== null,
      missingDevicePolls: state.missingDevicePolls,
      awaitingTrack,
    });
  }
  return { startedOrder, plays, polls, songs };
}

describe("short songs, end to end", () => {
  it("9s, 2s, 4s, 17s then a normal song: each starts once, in order, never replayed", () => {
    const { startedOrder, plays, songs } = simulate([9_000, 2_000, 4_000, 17_000, 210_000]);
    expect(startedOrder).toEqual(songs.map((s) => s.id));
    expect(plays).toBe(1); // the opening start; every change after that is the handoff queue
  });

  it("polls follow the songs: a normal song costs about one poll per 15s, short ones a couple each", () => {
    const normal = simulate([210_000, 210_000]).polls;
    expect(normal).toBeLessThanOrEqual(36);
    const short = simulate([9_000, 9_000, 9_000, 9_000]).polls;
    expect(short).toBeLessThanOrEqual(14);
  });
});
