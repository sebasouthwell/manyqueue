import { describe, expect, it } from "vitest";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { banTrack, isTrackBanned, lastBanCalledAt, listBannedUris } from "./bans.js";
import { createTimedVote } from "./votes.js";

function banVote(db: ReturnType<typeof createTestDb>, calledBy: string) {
  return createTimedVote(
    {
      roomId: "room-1",
      type: "ban",
      title: "Ban?",
      options: [{ id: "yes", label: "Ban it" }, { id: "no", label: "Keep it" }],
      deadlineAt: Date.now() + 30_000,
      meta: { calledBy },
    },
    db,
  );
}

describe("banned tracks", () => {
  it("bans a track for the room, idempotently", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    expect(isTrackBanned("room-1", "spotify:track:x", db)).toBe(false);
    banTrack("room-1", "spotify:track:x", null, db);
    banTrack("room-1", "spotify:track:x", null, db);
    expect(isTrackBanned("room-1", "spotify:track:x", db)).toBe(true);
    expect([...listBannedUris("room-1", db)]).toEqual(["spotify:track:x"]);
    expect(isTrackBanned("room-2", "spotify:track:x", db)).toBe(false);
  });
});

describe("lastBanCalledAt", () => {
  it("is null until the guest calls one, then the latest of theirs only", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    expect(lastBanCalledAt("room-1", "guest-1", db)).toBeNull();
    banVote(db, "someone-else");
    expect(lastBanCalledAt("room-1", "guest-1", db)).toBeNull();
    banVote(db, "guest-1");
    const at = lastBanCalledAt("room-1", "guest-1", db);
    expect(at).not.toBeNull();
    expect(Math.abs((at as number) - Date.now())).toBeLessThan(5_000);
  });
});
