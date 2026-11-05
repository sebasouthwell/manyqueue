import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, type DB } from "./client.js";
import { rooms } from "./schema.js";
import type { Host } from "./hosts.js";

export type Room = typeof rooms.$inferSelect;

// Avoids I, O, 0, 1 — easy to mix up when read off a TV from across the room.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomCode(length = 4): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function getRoomById(id: string, database: DB = db): Room | undefined {
  return database.select().from(rooms).where(eq(rooms.id, id)).get();
}

export function getRoomByCode(code: string): Room | undefined {
  return db.select().from(rooms).where(eq(rooms.code, code)).get();
}

export function getActiveRoomForHost(hostId: string): Room | undefined {
  return db
    .select()
    .from(rooms)
    .where(and(eq(rooms.hostId, hostId), eq(rooms.status, "active")))
    .get();
}

function createRoomForHost(host: Host): Room {
  let code = randomCode();
  let attempts = 0;
  while (getRoomByCode(code) && attempts < 20) {
    code = randomCode();
    attempts++;
  }

  const room: Room = {
    id: crypto.randomUUID(),
    code,
    hostId: host.id,
    name: `${host.displayName}'s Party`,
    status: "active",
    deviceId: null,
    deviceName: null,
    fallbackPlaylistUri: null,
    createdAt: new Date(),
    endedAt: null,
    exportPlaylistId: null,
    mysteryCounter: 0,
  };
  db.insert(rooms).values(room).run();
  return room;
}

export function getOrCreateActiveRoomForHost(host: Host): Room {
  return getActiveRoomForHost(host.id) ?? createRoomForHost(host);
}

export function setRoomName(roomId: string, name: string): void {
  db.update(rooms).set({ name }).where(eq(rooms.id, roomId)).run();
}

export function setRoomDevice(roomId: string, deviceId: string, deviceName: string): void {
  db.update(rooms).set({ deviceId, deviceName }).where(eq(rooms.id, roomId)).run();
}

export function setFallbackPlaylist(roomId: string, playlistUri: string): void {
  db.update(rooms).set({ fallbackPlaylistUri: playlistUri }).where(eq(rooms.id, roomId)).run();
}

export function setRoomExport(roomId: string, exportPlaylistId: string): void {
  db.update(rooms).set({ exportPlaylistId }).where(eq(rooms.id, roomId)).run();
}

export function setMysteryCounter(roomId: string, mysteryCounter: number, database = db): void {
  database.update(rooms).set({ mysteryCounter }).where(eq(rooms.id, roomId)).run();
}

export function endRoom(roomId: string, exportPlaylistId: string | null): void {
  db.update(rooms)
    .set({ status: "ended", endedAt: new Date(), exportPlaylistId })
    .where(eq(rooms.id, roomId))
    .run();
}

export function getAllActiveRoomsWithDevice(): Room[] {
  return db
    .select()
    .from(rooms)
    .where(and(eq(rooms.status, "active")))
    .all()
    .filter((r) => r.deviceId !== null);
}
