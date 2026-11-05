import crypto from "node:crypto";
import type { Room } from "./db/rooms.js";

/**
 * The recap names guests and shows their nicknames, so its link isn't just the 4-letter room code (which
 * anyone could guess): it carries a key only people who were at the party get to see (phones and the TV
 * are told it when the night ends). Derived, not stored, so it needs no new column.
 */
export function recapKey(room: Pick<Room, "id" | "code">): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) throw new Error("COOKIE_SECRET is not set");
  return crypto.createHmac("sha256", secret).update(`recap:${room.id}:${room.code}`).digest("hex").slice(0, 20);
}

export function recapKeyValid(room: Pick<Room, "id" | "code">, key: unknown): boolean {
  if (typeof key !== "string" || key.length !== 20) return false;
  const expected = Buffer.from(recapKey(room));
  const given = Buffer.from(key);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
