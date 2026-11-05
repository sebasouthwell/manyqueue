import type { Permission } from "@manyqueue/shared";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, type DB } from "./client.js";
import { guests } from "./schema.js";

export type Guest = typeof guests.$inferSelect;

export function getGuestById(id: string): Guest | undefined {
  return db.select().from(guests).where(eq(guests.id, id)).get();
}

/** Live guests only — a kicked guest's row is kept as an archive (kickedAt
 * set) but they're no longer part of the session. */
export function getGuestsForRoom(roomId: string, database: DB = db): Guest[] {
  return database.select().from(guests).where(eq(guests.roomId, roomId)).all().filter((g) => !g.kickedAt);
}

function nicknamesInRoom(roomId: string, excludeGuestId?: string): string[] {
  return db
    .select({ id: guests.id, nickname: guests.nickname, kickedAt: guests.kickedAt })
    .from(guests)
    .where(eq(guests.roomId, roomId))
    .all()
    .filter((g) => g.id !== excludeGuestId && !g.kickedAt)
    .map((g) => g.nickname);
}

function uniqueNickname(roomId: string, base: string, excludeGuestId?: string): string {
  const existing = new Set(nicknamesInRoom(roomId, excludeGuestId));
  if (!existing.has(base)) return base;

  let n = 2;
  while (existing.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function createGuest(
  roomId: string,
  rawNickname: string,
  emoji: string,
  device: { deviceId: string | null; ip: string | null } = { deviceId: null, ip: null },
): Guest {
  const now = new Date();
  const guest: Guest = {
    id: crypto.randomUUID(),
    roomId,
    nickname: uniqueNickname(roomId, rawNickname),
    emoji,
    role: "guest",
    muted: false,
    perms: [],
    canAnnounce: true,
    deviceId: device.deviceId,
    lastIp: device.ip,
    kickedAt: null,
    lastSeenAt: now,
    createdAt: now,
  };
  db.insert(guests).values(guest).run();
  return guest;
}

/** Refreshes the device/IP a guest was last seen from — called on an idempotent rejoin, so the
 * signal a future kick blocks against stays current even if they switch networks mid-party. */
export function touchGuestDevice(guestId: string, device: { deviceId: string | null; ip: string | null }): void {
  if (!device.deviceId && !device.ip) return;
  db.update(guests)
    .set({ ...(device.deviceId ? { deviceId: device.deviceId } : {}), ...(device.ip ? { lastIp: device.ip } : {}) })
    .where(eq(guests.id, guestId))
    .run();
}

export function setGuestRole(guestId: string, role: Guest["role"]): void {
  db.update(guests).set({ role }).where(eq(guests.id, guestId)).run();
}

export function setGuestPerms(guestId: string, perms: Permission[]): void {
  db.update(guests).set({ perms }).where(eq(guests.id, guestId)).run();
}

export function setGuestMuted(guestId: string, muted: boolean): void {
  db.update(guests).set({ muted }).where(eq(guests.id, guestId)).run();
}

export function setGuestCanAnnounce(guestId: string, canAnnounce: boolean): void {
  db.update(guests).set({ canAnnounce }).where(eq(guests.id, guestId)).run();
}

export function setGuestKicked(guestId: string): void {
  db.update(guests).set({ kickedAt: new Date() }).where(eq(guests.id, guestId)).run();
}


/** Updates a guest's nickname/emoji, keeping the room's dedupe suffix rule —
 * doesn't collide with itself if the nickname is unchanged. */
export function updateGuestIdentity(guest: Guest, nickname: string, emoji: string): Guest {
  const finalNickname = uniqueNickname(guest.roomId, nickname, guest.id);
  db.update(guests)
    .set({ nickname: finalNickname, emoji })
    .where(eq(guests.id, guest.id))
    .run();
  return { ...guest, nickname: finalNickname, emoji };
}
