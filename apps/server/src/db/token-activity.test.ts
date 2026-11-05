import { describe, it, expect } from "vitest";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { apply } from "./tokens.js";
import { addPaidQueueItem } from "./queue.js";
import { getGuestTokenActivity } from "./token-activity.js";

describe("getGuestTokenActivity", () => {
  it("resolves queue_add/replay_surcharge to the track name, newest first", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 5, reason: "start", cap: 5 }, db);

    addPaidQueueItem(
      {
        roomId: "room-1",
        trackUri: "spotify:track:abc",
        trackName: "Song A",
        artistName: "Artist",
        albumArtUrl: null,
        durationMs: 180_000,
        addedBy: guestId,
        cost: 2,
        playsTonight: 1,
        tokenCap: 5,
      },
      db,
    );

    const activity = getGuestTokenActivity(guestId, db);

    // Newest first: replay_surcharge and queue_add were written in that
    // insertion order, then start before that.
    expect(activity.map((a) => a.reason)).toEqual(["replay_surcharge", "queue_add", "start"]);
    expect(activity[0].label).toBe("Replay surcharge Song A");
    expect(activity[1].label).toBe("Added Song A");
    expect(activity[2].label).toBe("Starting tokens");
  });

  it("labels passive income without a track", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 1, reason: "passive", cap: 5 }, db);

    const activity = getGuestTokenActivity(guestId, db);
    expect(activity[0]).toMatchObject({ reason: "passive", label: "Earned for staying", delta: 1 });
  });
});
