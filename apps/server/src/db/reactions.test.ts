import { describe, expect, it } from "vitest";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { queueItems } from "./schema.js";
import { getGuestReactionCount, getReactionCounts, recordReaction } from "./reactions.js";

function seedItem(db: ReturnType<typeof createTestDb>) {
  const ids = seedRoomWithGuest(db);
  db.insert(queueItems)
    .values({
      id: "item-1",
      roomId: ids.roomId,
      trackUri: "spotify:track:1",
      trackName: "Song",
      artistName: "Artist",
      durationMs: 1000,
      position: 0,
      status: "playing",
      addedBy: ids.guestId,
      source: "queue",
      addedAt: new Date(),
    })
    .run();
  return ids;
}

describe("recordReaction", () => {
  it("counts per emoji and per guest for the song", () => {
    const db = createTestDb();
    const { guestId } = seedItem(db);
    for (let i = 0; i < 3; i++) recordReaction("item-1", guestId, "🔥", db);
    recordReaction("item-1", guestId, "💀", db);
    expect(getReactionCounts("item-1", db)).toEqual({ "🔥": 3, "💀": 1 });
    expect(getGuestReactionCount("item-1", guestId, db)).toBe(4);
  });
});
