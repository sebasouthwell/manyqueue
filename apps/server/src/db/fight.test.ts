import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { guests, queueItems } from "./schema.js";
import { addQueueItem, getOnDeckItems, getQueueItemById } from "./queue.js";
import { updateRoomSettings } from "./settings.js";
import { apply, balance } from "./tokens.js";
import { ensureRotationState, getMineQueue, getRotationRoster } from "./rotation.js";
import { listPoolEntries } from "./contest.js";
import { enterFight, leaveFight, settleFight, clearFights } from "./fight.js";
import { buildMineView } from "../realtime/rotation-views.js";
import type { DB } from "./client.js";

function addGuest(db: DB, id: string) {
  db.insert(guests)
    .values({ id, roomId: "room-1", nickname: id, emoji: "🦋", role: "guest", lastSeenAt: new Date(), createdAt: new Date() })
    .run();
}

function addMineSong(db: DB, guestId: string, uri: string, minePosition: number) {
  const item = addQueueItem(
    { roomId: "room-1", trackUri: uri, trackName: uri, artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy: guestId },
    db,
  );
  db.update(queueItems).set({ status: "mine", minePosition }).where(eq(queueItems.id, item.id)).run();
  return item;
}

function setUp(db: DB, tokenMode = true) {
  seedRoomWithGuest(db); // guest-1
  addGuest(db, "guest-2");
  updateRoomSettings("room-1", { mode: "rotation", tokenMode, tokenCap: 20 }, db);
  const songs: Record<string, ReturnType<typeof addMineSong>[]> = {};
  for (const g of ["guest-1", "guest-2"]) {
    ensureRotationState("room-1", g, db);
    if (tokenMode) apply({ roomId: "room-1", guestId: g, delta: 5, reason: "start", cap: 20 }, db);
    songs[g] = [0, 1, 2].map((i) => addMineSong(db, g, `${g}-song-${i}`, i));
  }
  return songs;
}

describe("Fight for a spot", () => {
  it("entering costs 1 token, takes the song out of the rotation, and shows in the guest's own list", () => {
    const db = createTestDb();
    const songs = setUp(db);
    const before = balance("guest-1", db);
    const r = enterFight("room-1", "guest-1", songs["guest-1"][1].id, db);
    expect(r.ok).toBe(true);
    expect(balance("guest-1", db)).toBe(before - 1);
    expect(getMineQueue("room-1", "guest-1", db).map((m) => m.id)).not.toContain(songs["guest-1"][1].id);
    expect(buildMineView("room-1", "guest-1", db).find((m) => m.id === songs["guest-1"][1].id)?.inFight).toBe(true);
    // one at a time
    const again = enterFight("room-1", "guest-1", songs["guest-1"][0].id, db);
    expect(again).toEqual({ ok: false, error: "already_fighting" });
  });

  it("not with a song on deck, not in Crowd pick, not when broke", () => {
    const db = createTestDb();
    const songs = setUp(db);
    db.update(queueItems).set({ status: "on_deck", position: 1 }).where(eq(queueItems.id, songs["guest-2"][0].id)).run();
    expect(enterFight("room-1", "guest-2", songs["guest-2"][1].id, db)).toEqual({ ok: false, error: "on_deck" });
    apply({ roomId: "room-1", guestId: "guest-1", delta: -5, reason: "grant", cap: 20 }, db);
    expect(enterFight("room-1", "guest-1", songs["guest-1"][0].id, db)).toEqual({ ok: false, error: "cant_afford" });
    updateRoomSettings("room-1", { nextSongMethod: "crowd" }, db);
    expect(enterFight("room-1", "guest-1", songs["guest-1"][0].id, db)).toEqual({ ok: false, error: "off" });
  });

  it("the winner goes straight on deck, entry refunded, charged like a draft, and keeps their turn", () => {
    const db = createTestDb();
    const songs = setUp(db);
    const a = enterFight("room-1", "guest-1", songs["guest-1"][2].id, db);
    const b = enterFight("room-1", "guest-2", songs["guest-2"][0].id, db);
    if (!a.ok || !b.ok) throw new Error("enter failed");
    const creditBefore = getRotationRoster("room-1", db).map((r) => [r.guestId, r.credit, r.lastTurnAt]);
    const balanceBefore = balance("guest-1", db);

    const result = settleFight(a.entry.id, b.entry.id, db);
    const won = getQueueItemById(songs["guest-1"][2].id, db)!;
    expect(won.status).toBe("on_deck");
    expect(won.draftedBy).toBe("fight");
    expect(getOnDeckItems("room-1", db).map((o) => o.id)).toContain(won.id);
    // +1 entry back, -1 for the song (price 1 at 0 plays tonight)
    expect(balance("guest-1", db)).toBe(balanceBefore + 1 - 1);
    expect(result.winnerDelta).toBe(0);
    expect(getRotationRoster("room-1", db).map((r) => [r.guestId, r.credit, r.lastTurnAt])).toEqual(creditBefore);

    // the loser is back in its place, its entry spent
    const lost = getQueueItemById(songs["guest-2"][0].id, db)!;
    expect(lost.status).toBe("mine");
    expect(getMineQueue("room-1", "guest-2", db)[0].id).toBe(lost.id);
    expect(listPoolEntries("room-1", db)).toHaveLength(0);
  });

  it("leaving, or fights closing, puts the song back and refunds the entry", () => {
    const db = createTestDb();
    const songs = setUp(db);
    const before = balance("guest-1", db);
    const a = enterFight("room-1", "guest-1", songs["guest-1"][0].id, db);
    if (!a.ok) throw new Error("enter failed");
    expect(leaveFight(a.entry.id, "refund_reject", db)?.refunded).toBe(1);
    expect(balance("guest-1", db)).toBe(before);
    expect(getMineQueue("room-1", "guest-1", db)[0].id).toBe(songs["guest-1"][0].id);

    enterFight("room-1", "guest-1", songs["guest-1"][0].id, db);
    enterFight("room-1", "guest-2", songs["guest-2"][0].id, db);
    expect(clearFights("room-1", [], db)).toHaveLength(2);
    expect(listPoolEntries("room-1", db)).toHaveLength(0);
  });

  it("free with tokens off", () => {
    const db = createTestDb();
    const songs = setUp(db, false);
    const a = enterFight("room-1", "guest-1", songs["guest-1"][0].id, db);
    expect(a.ok && a.item.paid).toBe(0);
  });
});
