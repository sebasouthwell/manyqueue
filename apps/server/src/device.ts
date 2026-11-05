import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const COOKIE_NAME = "device_id";
const MAX_AGE_SEC = 60 * 60 * 24 * 365; // a year

/**
 * A long-lived id for this browser, separate from guest_session. A guest can clear just their
 * guest_session cookie (or open a private tab) to shed a mute, a kick, or a spent token balance and
 * show up as a brand new guest with a fresh identity — this cookie doesn't reset when that one does,
 * so a kick's device block and the new-guest rate limit below still recognise them as the same device.
 * It is not a security boundary (a determined person can still clear it too), just raises the bar
 * above "close and reopen the tab".
 */
export function getOrSetDeviceId(req: FastifyRequest, reply: FastifyReply): string {
  const raw = req.cookies[COOKIE_NAME];
  if (raw) {
    const unsigned = req.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) return unsigned.value;
  }
  const id = crypto.randomUUID();
  reply.setCookie(COOKIE_NAME, id, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
  return id;
}

const JOIN_WINDOW_MS = 60 * 60 * 1000;
/** New guest identities one device may create in one room per hour. Existing-guest rejoins (the
 * common case) don't count against this — only actually creating a fresh row does. */
const NEW_GUESTS_PER_DEVICE_PER_HOUR = 4;

/** Backstop per network address. The device cookie is only as good as a client's willingness to send it
 * back — a script that drops it gets a fresh "device" every time (seen: 30 joins in a row from one
 * machine). Generous, because a whole party usually shares one venue Wi-Fi address. */
const NEW_GUESTS_PER_IP_PER_HOUR = 40;

const joinsByDevice = new Map<string, number[]>();
const joinsByIp = new Map<string, number[]>();

function recentJoins(map: Map<string, number[]>, key: string, now: number): number[] {
  const recent = (map.get(key) ?? []).filter((at) => now - at < JOIN_WINDOW_MS);
  map.set(key, recent);
  return recent;
}

/** True (and records the attempt) if this device, and the address it's on, may create another new
 * guest in this room right now. */
export function allowNewGuestFor(roomId: string, deviceId: string, ip?: string): boolean {
  const now = Date.now();
  const byDevice = recentJoins(joinsByDevice, `${roomId}:${deviceId}`, now);
  const byIp = ip ? recentJoins(joinsByIp, `${roomId}:${ip}`, now) : null;
  if (byDevice.length >= NEW_GUESTS_PER_DEVICE_PER_HOUR) return false;
  if (byIp && byIp.length >= NEW_GUESTS_PER_IP_PER_HOUR) return false;
  byDevice.push(now);
  byIp?.push(now);
  return true;
}
