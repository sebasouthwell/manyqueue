import { describe, it, expect } from "vitest";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { guests } from "./schema.js";
import { eq } from "drizzle-orm";
import { setGlitch, startArmedGlitch, finishGlitch, glitchStateOf } from "./glitch.js";
import { hasPermission } from "@manyqueue/shared";

const guestOf = (db: ReturnType<typeof createTestDb>) => db.select().from(guests).where(eq(guests.id, "guest-1")).get()!;

describe("glitch state", () => {
  it("next visit: waits armed, starts when the phone says so, and a timed one turns itself off", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    expect(setGlitch("guest-1", { level: 80, durationSec: 10, nextVisit: true }, db)).toMatchObject({ level: 80, armed: true, startedAt: null });
    const started = startArmedGlitch("guest-1", db);
    expect(started.armed).toBe(false);
    expect(started.startedAt).not.toBeNull();
    // still running: done is refused
    expect(finishGlitch("guest-1", db).level).toBe(80);
    // run out the clock
    db.update(guests).set({ glitchStartedAt: new Date(Date.now() - 20_000) }).where(eq(guests.id, "guest-1")).run();
    expect(glitchStateOf(guestOf(db)).level).toBe(0);
    expect(finishGlitch("guest-1", db).level).toBe(0);
    expect(guestOf(db).glitchLevel).toBe(0);
  });

  it("until stopped never runs out; level 0 stops it", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    setGlitch("guest-1", { level: 40, durationSec: null, nextVisit: false }, db);
    db.update(guests).set({ glitchStartedAt: new Date(Date.now() - 3_600_000) }).where(eq(guests.id, "guest-1")).run();
    expect(glitchStateOf(guestOf(db)).level).toBe(40);
    expect(setGlitch("guest-1", { level: 0, durationSec: null, nextVisit: false }, db).level).toBe(0);
  });

  it("the glitch permission is never part of co-host", () => {
    expect(hasPermission({ role: "cohost", perms: [] }, "glitch")).toBe(false);
    expect(hasPermission({ role: "cohost", perms: ["glitch"] }, "glitch")).toBe(true);
    expect(hasPermission({ role: "cohost", perms: [] }, "skip")).toBe(true);
    expect(hasPermission({ role: "host" }, "glitch")).toBe(true);
  });
});
