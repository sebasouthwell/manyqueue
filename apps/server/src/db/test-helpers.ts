import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { hosts, rooms, guests } from "./schema.js";
import type { DB } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A fresh in-memory DB with every migration applied — for tests that need the
 * real schema (constraints, defaults) rather than a hand-rolled subset. */
export function createTestDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return db;
}

/** Minimal host/room/guest fixture shared by every DB test that needs a
 * guest to attach ledger/queue rows to. */
export function seedRoomWithGuest(db: DB) {
  const now = new Date();
  db.insert(hosts)
    .values({
      id: "host-1",
      spotifyUserId: "spotify-1",
      displayName: "Test Host",
      refreshTokenEnc: "enc",
      tokenIv: "iv",
      createdAt: now,
    })
    .run();
  db.insert(rooms)
    .values({
      id: "room-1",
      code: "TEST",
      hostId: "host-1",
      name: "Test Room",
      status: "active",
      deviceId: null,
      deviceName: null,
      fallbackPlaylistUri: null,
      createdAt: now,
      endedAt: null,
      exportPlaylistId: null,
    })
    .run();
  db.insert(guests)
    .values({
      id: "guest-1",
      roomId: "room-1",
      nickname: "Maya",
      emoji: "🦋",
      role: "guest",
      lastSeenAt: now,
      createdAt: now,
    })
    .run();
  return { roomId: "room-1", guestId: "guest-1" };
}
