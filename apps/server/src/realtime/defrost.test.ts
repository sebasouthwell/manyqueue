import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Server } from "socket.io";
import { maybeDefrost, isDefrostHolding, resetDefrostForTests, DEFROST_MS } from "./defrost.js";
import type { Room } from "../db/rooms.js";
import type { QueueItem } from "../db/queue.js";

const room = { id: "r1", code: "ROOM", hostId: "h1", deviceId: "pc" } as Room;
const mariah = (over: Partial<QueueItem> = {}) =>
  ({ id: "q1", trackName: "All I Want for Christmas Is You", artistName: "Mariah Carey", dedication: null, dedicationHidden: false, addedBy: "g1", anonymous: false, ...over }) as QueueItem;

function setup(date: string, holidayMode = "auto") {
  const emitted: unknown[] = [];
  const io = { to: () => ({ emit: (_e: string, p: unknown) => emitted.push(p) }) } as unknown as Server;
  const calls: string[] = [];
  const deps = {
    pause: vi.fn(async () => void calls.push("pause")),
    resume: vi.fn(async () => void calls.push("resume")),
    seek: vi.fn(async (_h: string, _d: string, ms: number) => void calls.push(`seek ${ms}`)),
    now: () => new Date(date),
    holidayMode: () => holidayMode,
    nickname: () => "Sam",
  };
  return { io, deps, emitted, calls };
}

describe("maybeDefrost (November's first Mariah)", () => {
  beforeEach(() => {
    resetDefrostForTests();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("pauses her, holds the loop, then restarts from 0:00 when the ice shatters", async () => {
    const { io, deps, emitted, calls } = setup("2026-11-05T22:00:00Z");
    expect(maybeDefrost(io, room, mariah(), deps)).toBe(true);
    expect(isDefrostHolding("r1")).toBe(true);
    expect(emitted[0]).toMatchObject({ dedication: null, durationMs: DEFROST_MS });
    await vi.advanceTimersByTimeAsync(DEFROST_MS + 10);
    expect(calls).toEqual(["pause", "seek 0", "resume"]);
    expect(isDefrostHolding("r1")).toBe(false);
  });

  it("once per room per night, and the small hours still count as the same night", () => {
    const first = setup("2026-11-05T22:00:00Z");
    expect(maybeDefrost(first.io, room, mariah(), first.deps)).toBe(true);
    const later = setup("2026-11-06T02:00:00Z");
    expect(maybeDefrost(later.io, room, mariah(), later.deps)).toBe(false);
  });

  it("only in November, only for Mariah, and not with holidays off", () => {
    const dec = setup("2026-12-05T22:00:00Z");
    expect(maybeDefrost(dec.io, room, mariah(), dec.deps)).toBe(false);
    const cover = setup("2026-11-05T22:00:00Z");
    expect(maybeDefrost(cover.io, room, mariah({ artistName: "Michael Bublé" }), cover.deps)).toBe(false);
    const off = setup("2026-11-05T22:00:00Z", "off");
    expect(maybeDefrost(off.io, room, mariah(), off.deps)).toBe(false);
  });

  it("a dedication takes the warning's place, with who sent it", () => {
    const { io, deps, emitted } = setup("2026-11-05T22:00:00Z");
    maybeDefrost(io, room, mariah({ dedication: "for Jess ❄️" }), deps);
    expect(emitted[0]).toMatchObject({ dedication: "for Jess ❄️", from: "Sam" });
  });
});
