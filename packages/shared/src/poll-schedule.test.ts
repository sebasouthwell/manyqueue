import { describe, expect, it } from "vitest";
import {
  END_GRACE_MS,
  HANDOFF_POLL_AT_MS,
  HANDOFF_WINDOW_MS,
  POLL_AWAIT_MS,
  POLL_FAST_MS,
  POLL_IDLE_MS,
  POLL_MID_SONG_MAX_MS,
  POLL_PAUSED_MS,
  pollDelayMs,
} from "./poll-schedule";

const base = { isPlaying: true, progressMs: 60_000, durationMs: 200_000, hasWork: true, pendingTrackChange: false, missingDevicePolls: 0 };

/** Polls made over one song, from its first confirmed poll at 0 to just past its end. */
function pollsOver(duration: number) {
  const at: number[] = [];
  let t = 0;
  while (t <= duration) {
    at.push(t);
    t += pollDelayMs({ ...base, progressMs: t, durationMs: duration });
  }
  return { count: at.length, at, firstAfterEnd: t };
}

describe("pollDelayMs", () => {
  it("polls slowly in the middle of a song", () => {
    expect(pollDelayMs(base)).toBe(POLL_MID_SONG_MAX_MS);
  });
  it("lands one poll just inside the handoff window", () => {
    const d = pollDelayMs({ ...base, progressMs: 200_000 - (HANDOFF_POLL_AT_MS + 8_000) });
    expect(d).toBe(8_000);
  });
  it("from the handoff on, the next poll lands just after the predicted end", () => {
    expect(pollDelayMs({ ...base, progressMs: 200_000 - 14_000 })).toBe(14_000 + END_GRACE_MS);
    expect(pollDelayMs({ ...base, progressMs: 200_000 - HANDOFF_WINDOW_MS })).toBe(HANDOFF_WINDOW_MS + END_GRACE_MS);
  });
  it("past the predicted end, checks again within a second", () => {
    expect(pollDelayMs({ ...base, progressMs: 200_000 })).toBe(POLL_AWAIT_MS);
    expect(pollDelayMs({ ...base, progressMs: 205_000 })).toBe(POLL_AWAIT_MS);
  });
  it("polls every second while a song we asked for is due", () => {
    expect(pollDelayMs({ ...base, awaitingTrack: true })).toBe(POLL_AWAIT_MS);
    expect(pollDelayMs({ ...base, isPlaying: false, awaitingTrack: true })).toBe(POLL_AWAIT_MS);
  });
  it("polls fast whenever it's counting confirming polls", () => {
    expect(pollDelayMs({ ...base, pendingTrackChange: true })).toBe(POLL_FAST_MS);
    expect(pollDelayMs({ ...base, missingDevicePolls: 1 })).toBe(POLL_FAST_MS);
  });
  it("is slow when paused and slower when there's nothing to play", () => {
    expect(pollDelayMs({ ...base, isPlaying: false })).toBe(POLL_PAUSED_MS);
    expect(pollDelayMs({ ...base, hasWork: false })).toBe(POLL_IDLE_MS);
  });
  it("falls back to fast when the duration is unknown", () => {
    expect(pollDelayMs({ ...base, durationMs: 0 })).toBe(POLL_FAST_MS);
  });
  it("a 3:30 song: about one poll every 15s, a handoff poll, and one just after the end", () => {
    const { count, firstAfterEnd } = pollsOver(210_000);
    expect(count).toBeLessThanOrEqual(15);
    expect(firstAfterEnd).toBe(210_000 + END_GRACE_MS);
  });
  it("a 9-second song: two polls, the second right after it ends", () => {
    const { count, firstAfterEnd } = pollsOver(9_000);
    expect(count).toBe(1);
    expect(firstAfterEnd).toBe(9_000 + END_GRACE_MS);
  });
});
