import { describe, expect, it } from "vitest";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import {
  bumpAiUsage,
  getAiUsage,
  hideAllNicknamesFor,
  insertNickname,
  latestNicknameFor,
  listLatestNicknames,
  markNicknameAnnounced,
  setNicknameStatus,
  shownNicknameFor,
  unannouncedShown,
} from "./ai-nicknames.js";

const t = (s: number) => new Date(1_700_000_000_000 + s * 1000);

describe("ai nickname storage", () => {
  it("shows the newest visible nickname, while a newer pending one waits", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    insertNickname({ roomId: "room-1", guestId: "guest-1", nickname: "Old One 🎵", why: "a", status: "shown", atFinished: 8, now: t(1) }, db);
    const pending = insertNickname({ roomId: "room-1", guestId: "guest-1", nickname: "New One 🎶", why: "b", status: "pending", atFinished: 24, now: t(2) }, db);

    expect(shownNicknameFor("room-1", "guest-1", db)?.nickname).toBe("Old One 🎵");
    expect(latestNicknameFor("room-1", "guest-1", db)?.id).toBe(pending.id);
    expect(listLatestNicknames("room-1", db)).toHaveLength(1);

    setNicknameStatus(pending.id, "shown", db);
    expect(shownNicknameFor("room-1", "guest-1", db)?.nickname).toBe("New One 🎶");
  });

  it("Hide takes every nickname away, so an older one can't come back", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    insertNickname({ roomId: "room-1", guestId: "guest-1", nickname: "Old One 🎵", why: "a", status: "shown", atFinished: 8, now: t(1) }, db);
    insertNickname({ roomId: "room-1", guestId: "guest-1", nickname: "New One 🎶", why: "b", status: "shown", atFinished: 24, now: t(2) }, db);
    hideAllNicknamesFor("room-1", "guest-1", db);
    expect(shownNicknameFor("room-1", "guest-1", db)).toBeUndefined();
    expect(latestNicknameFor("room-1", "guest-1", db)?.status).toBe("hidden");
  });

  it("announces each visible nickname once, oldest first", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = insertNickname({ roomId: "room-1", guestId: "guest-1", nickname: "A 🎵", why: "a", status: "shown", atFinished: 8, now: t(1) }, db);
    insertNickname({ roomId: "room-1", guestId: "guest-1", nickname: "P 🎶", why: "p", status: "pending", atFinished: 8, now: t(2) }, db);
    expect(unannouncedShown("room-1", db).map((n) => n.nickname)).toEqual(["A 🎵"]);
    markNicknameAnnounced(a.id, t(3), db);
    expect(unannouncedShown("room-1", db)).toEqual([]);
  });

  it("counts AI calls per room by kind", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    expect(getAiUsage("room-1", db)).toEqual({ nicknameCalls: 0, genreCalls: 0 });
    bumpAiUsage("room-1", "nickname", db);
    bumpAiUsage("room-1", "genre", db);
    bumpAiUsage("room-1", "nickname", db);
    expect(getAiUsage("room-1", db)).toEqual({ nicknameCalls: 2, genreCalls: 1 });
  });
});
