import { and, eq } from "drizzle-orm";
import { db } from "./client.js";
import { blockedDevices } from "./schema.js";

export function blockDevice(roomId: string, deviceId: string): void {
  if (!deviceId) return;
  db.insert(blockedDevices).values({ roomId, deviceId, createdAt: new Date() }).run();
}

export function isDeviceBlocked(roomId: string, deviceId: string): boolean {
  if (!deviceId) return false;
  const row = db
    .select()
    .from(blockedDevices)
    .where(and(eq(blockedDevices.roomId, roomId), eq(blockedDevices.deviceId, deviceId)))
    .get();
  return !!row;
}
