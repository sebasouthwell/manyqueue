import { eq } from "drizzle-orm";
import { RoomSettingsSchema, DEFAULT_ROOM_SETTINGS, type RoomSettings } from "@manyqueue/shared";
import { db, type DB } from "./client.js";
import { roomSettings } from "./schema.js";

export function getRoomSettings(roomId: string, database: DB = db): RoomSettings {
  const row = database.select().from(roomSettings).where(eq(roomSettings.roomId, roomId)).get();
  if (!row) return DEFAULT_ROOM_SETTINGS;

  try {
    return RoomSettingsSchema.parse(JSON.parse(row.json));
  } catch {
    return DEFAULT_ROOM_SETTINGS;
  }
}

export function updateRoomSettings(roomId: string, patch: Partial<RoomSettings>, database: DB = db): RoomSettings {
  const current = getRoomSettings(roomId, database);
  const next = RoomSettingsSchema.parse({ ...current, ...patch });
  const json = JSON.stringify(next);
  const now = new Date();

  const existing = database.select().from(roomSettings).where(eq(roomSettings.roomId, roomId)).get();
  if (existing) {
    database.update(roomSettings).set({ json, updatedAt: now }).where(eq(roomSettings.roomId, roomId)).run();
  } else {
    database.insert(roomSettings).values({ roomId, json, updatedAt: now }).run();
  }

  return next;
}
