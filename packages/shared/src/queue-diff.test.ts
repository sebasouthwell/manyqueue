import { describe, it, expect } from "vitest";
import { diffSpotifyQueue, skipsToReach } from "./queue-diff.js";

describe("diffSpotifyQueue", () => {
  it("matches when our locked track is first", () => {
    expect(diffSpotifyQueue(["a", "x"], "a")).toEqual({ foreignAhead: 0 });
  });
  it("counts tracks queued ahead of ours", () => {
    expect(diffSpotifyQueue(["f1", "f2", "a"], "a")).toEqual({ foreignAhead: 2 });
  });
  it("reports nothing when nothing is locked", () => {
    expect(diffSpotifyQueue(["f1"], null)).toEqual({ foreignAhead: 0 });
  });
  it("reports nothing when our locked track isn't in Spotify's queue", () => {
    expect(diffSpotifyQueue(["f1", "f2"], "a")).toEqual({ foreignAhead: 0 });
  });
  it("handles an empty queue", () => {
    expect(diffSpotifyQueue([], "a")).toEqual({ foreignAhead: 0 });
  });
});

describe("skipsToReach", () => {
  it("one skip when ours is next, more past anything queued ahead of it", () => {
    expect(skipsToReach(["a", "b"], "a")).toBe(1);
    expect(skipsToReach(["x", "y", "a"], "a")).toBe(3);
  });
  it("null when it isn't in the queue", () => {
    expect(skipsToReach(["x"], "a")).toBeNull();
    expect(skipsToReach([], "a")).toBeNull();
  });
  it("the first copy wins", () => {
    expect(skipsToReach(["a", "x", "a"], "a")).toBe(1);
  });
});
