import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "../db/test-helpers.js";
import { guests, queueItems } from "../db/schema.js";
import { addQueueItem, getOnDeckItems } from "../db/queue.js";
import { updateRoomSettings } from "../db/settings.js";
import { ensureRotationState, getRotationRoster } from "../db/rotation.js";
import { getRoomById } from "../db/rooms.js";
import { refillOnDeck } from "./rotation-loop.js";
import { buildHostRotationBoard } from "./rotation-views.js";
import { vetoTick, skipPendingDraft, vetoCommitsAt, resetVetoState } from "./draft-veto.js";
import type { DB } from "../db/client.js";

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

const LEAD = 17_000;
const tick = (playingItemId: string, remainingMs: number) => ({ playingItemId, durationMs: 180_000, remainingMs, commitLeadMs: LEAD });

function setUp(db: DB, draftingStyle: "auto_veto" | "automatic" = "auto_veto") {
  seedRoomWithGuest(db);
  addGuest(db, "guest-2");
  addGuest(db, "guest-3");
  updateRoomSettings("room-1", { mode: "rotation", draftingStyle, tokenMode: false, mysteryEvery: 0 }, db);
  for (const guestId of ["guest-1", "guest-2", "guest-3"]) {
    ensureRotationState("room-1", guestId, db);
    for (let i = 0; i < 2; i++) addMineSong(db, guestId, `${guestId}-song-${i}`, i);
  }
  const room = getRoomById("room-1", db)!;
  refillOnDeck(room, db);
  const [first] = getOnDeckItems("room-1", db);
  db.update(queueItems).set({ status: "playing" }).where(eq(queueItems.id, first.id)).run();
  return { room, playing: first };
}

describe("Auto + veto", () => {
  beforeEach(() => resetVetoState());

  it("opens 15s before the draft commits and shows the host what rotation will pick", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    expect(vetoTick(room, tick(playing.id, 60_000), db)).toBe(false);
    expect(buildHostRotationBoard(room, db).pendingDraft).toBeNull();

    const now = 1_000_000;
    expect(vetoTick(room, tick(playing.id, LEAD + 10_000), db, now)).toBe(true);
    expect(vetoCommitsAt(room.id)).toBe(now + 10_000);
    const pending = buildHostRotationBoard(room, db).pendingDraft!;
    expect(pending.kind).toBe("guest");
    expect(pending.itemId).toBe(buildHostRotationBoard(room, db).upcoming[0].itemId);
  });

  it("Skip gives the slot to the next in line; the skipped guest keeps their credit and song", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    vetoTick(room, tick(playing.id, LEAD + 5_000), db);
    const pending = buildHostRotationBoard(room, db).pendingDraft!;
    const skippedGuest = pending.guestId!;
    const creditBefore = getRotationRoster("room-1", db).find((r) => r.guestId === skippedGuest)!.credit;

    expect(skipPendingDraft(room.id, skippedGuest)).toBe(true);
    const next = buildHostRotationBoard(room, db).pendingDraft!;
    expect(next.guestId).not.toBe(skippedGuest);

    // the commit: the handoff's refill drafts the replacement
    vetoTick(room, tick(playing.id, LEAD - 1), db);
    expect(refillOnDeck(room, db, { nextDue: true })).toBe(true);
    const drafted = getOnDeckItems("room-1", db).find((o) => o.status === "on_deck")!;
    expect(drafted.id).toBe(next.itemId);
    expect(getRotationRoster("room-1", db).find((r) => r.guestId === skippedGuest)!.credit).toBe(creditBefore);
    const skippedSong = db.select().from(queueItems).where(eq(queueItems.id, pending.itemId!)).get()!;
    expect(skippedSong.status).toBe("mine");

    // once the slot is filled the skip is forgotten: they're back in the forecast
    vetoTick(room, tick(playing.id, LEAD - 2), db);
    expect(buildHostRotationBoard(room, db).upcoming.some((u) => u.guestId === skippedGuest)).toBe(true);
  });

  it("no window in Automatic, once the next song is on deck, or after the commit point", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db, "automatic");
    expect(vetoTick(room, tick(playing.id, LEAD + 5_000), db)).toBe(false);
    expect(skipPendingDraft(room.id, "guest-2")).toBe(false);

    updateRoomSettings("room-1", { draftingStyle: "auto_veto" }, db);
    expect(vetoTick(room, tick(playing.id, LEAD - 1), db)).toBe(false);
    refillOnDeck(room, db, { nextDue: true });
    expect(vetoTick(room, tick(playing.id, LEAD + 5_000), db)).toBe(false);
    expect(buildHostRotationBoard(room, db).pendingDraft).toBeNull();
  });
});
