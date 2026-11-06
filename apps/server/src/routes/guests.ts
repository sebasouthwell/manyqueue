import type { FastifyPluginAsync } from "fastify";
import type { Permission } from "@manyqueue/shared";
import { GUEST_EMOJI, SOCKET_EVENTS, announcementCooldownLeft, checkAnnouncement, type ToastPayload } from "@manyqueue/shared";
import { reactionsReceivedBy } from "../db/reaction-stats.js";
import { getRoomByCode } from "../db/rooms.js";
import { createGuest, getGuestById, touchGuestDevice, updateGuestIdentity } from "../db/guests.js";
import { ensureRotationState } from "../db/rotation.js";
import { isDeviceBlocked } from "../db/blocked-devices.js";
import { allowNewGuestFor, getOrSetDeviceId } from "../device.js";
import { getRoomSettings } from "../db/settings.js";
import { apply, balance, history } from "../db/tokens.js";
import { getGuestTokenActivity } from "../db/token-activity.js";
import { countSongsAddedBy, serializeQueue } from "../db/queue.js";
import { getActiveGuest, getAuthenticatedGuestId } from "../auth-helpers.js";
import { getIO } from "../realtime/io-instance.js";
import { guestNickname } from "../realtime/ai-nicknames.js";
import { guestLabels } from "../realtime/labels.js";
import { roomChannel } from "../realtime/socket-server.js";
import { recordAction } from "../realtime/action-log-broadcast.js";

const lastAnnouncementAt = new Map<string, number>();

interface JoinBody {
  nickname?: string;
  emoji?: string;
}

interface IdentityBody {
  nickname?: string;
  emoji?: string;
}

const IDENTITY_CHANGE_COOLDOWN_MS = 10 * 60 * 1000;
const lastIdentityChangeAt = new Map<string, number>();

function serializeGuest(
  guest: {
    id: string;
    nickname: string;
    emoji: string;
    role: "guest" | "cohost";
    muted: boolean;
    perms: Permission[];
    canAnnounce: boolean;
  },
  tokenBalance: number,
) {
  return {
    id: guest.id,
    nickname: guest.nickname,
    emoji: guest.emoji,
    role: guest.role,
    muted: guest.muted,
    perms: guest.perms ?? [],
    canAnnounce: guest.canAnnounce,
    tokenBalance,
  };
}

export const guestRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { code: string }; Body: JoinBody }>(
    "/rooms/:code/join",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room || room.status !== "active") {
        return reply.code(404).send({ error: "room_not_found" });
      }

      // The device cookie survives a cleared guest_session, so it (not just the IP, which is unreliable
      // behind a proxy/tunnel and shared by a whole household anyway) is what a kick actually blocks.
      const deviceId = getOrSetDeviceId(req, reply);
      if (isDeviceBlocked(room.id, deviceId) || isDeviceBlocked(room.id, req.ip)) {
        return reply.code(403).send({ error: "blocked" });
      }

      const roomSettings = getRoomSettings(room.id);

      // A device that already joined this room (a valid guest cookie) is the same guest: joining again, from a double
      // tap or a second tab, returns them instead of making "Sam 2", "Sam 3"...
      const existingId = getAuthenticatedGuestId(req);
      const existing = existingId ? getGuestById(existingId) : undefined;
      if (existing && existing.roomId === room.id && !existing.kickedAt) {
        touchGuestDevice(existing.id, { deviceId, ip: req.ip });
        // Covers a guest who first joined before the room switched to Rotation mode, or otherwise
        // somehow has no roster row yet — draft() can never see them without one (self-healing, and
        // a no-op once they already have a row).
        if (roomSettings.mode === "rotation") ensureRotationState(room.id, existing.id);
        return { guest: serializeGuest(existing, balance(existing.id)) };
      }

      const nickname = (typeof req.body?.nickname === "string" ? req.body.nickname : "").trim().slice(0, 20);
      const emoji = req.body?.emoji ?? "";
      if (nickname.length < 1) return reply.code(400).send({ error: "invalid_nickname" });
      if (!GUEST_EMOJI.includes(emoji as (typeof GUEST_EMOJI)[number])) {
        return reply.code(400).send({ error: "invalid_emoji" });
      }

      // A genuinely new guest identity (not a rejoin) — capped per device per room, so clearing
      // guest_session over and over to dodge a mute or keep collecting the join bonus doesn't work.
      if (!allowNewGuestFor(room.id, deviceId, req.ip)) {
        return reply.code(429).send({ error: "too_many_new_guests" });
      }

      const guest = createGuest(room.id, nickname, emoji, { deviceId, ip: req.ip });
      // A brand-new guest joining a room that's already in Rotation mode otherwise never gets a
      // rotation_state row at all — only a Shared -> Rotation switch creates one (R2's migration).
      if (roomSettings.mode === "rotation") ensureRotationState(room.id, guest.id);

      reply.setCookie("guest_session", guest.id, {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });

      const grant = apply({
        roomId: room.id,
        guestId: guest.id,
        delta: roomSettings.startTokens,
        reason: "start",
        cap: roomSettings.tokenCap,
      });

      const toast: ToastPayload = {
        id: crypto.randomUUID(),
        message: `${guest.emoji} ${guest.nickname} joined`,
        emoji: guest.emoji,
        join: { emoji: guest.emoji, nickname: guest.nickname },
      };
      getIO().to(`room:${room.code}`).emit(SOCKET_EVENTS.TOAST, toast);

      return { guest: serializeGuest(guest, grant.balance) };
    },
  );

  app.get<{ Params: { code: string } }>("/rooms/:code/me", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });

    const raw = req.cookies.guest_session;
    if (!raw) return reply.code(401).send({ error: "not_joined" });

    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return reply.code(401).send({ error: "not_joined" });

    const guest = getGuestById(unsigned.value);
    if (!guest || guest.roomId !== room.id) {
      return reply.code(401).send({ error: "not_joined" });
    }
    if (guest.kickedAt) {
      return reply.code(403).send({ error: "kicked" });
    }

    const settings = getRoomSettings(room.id);
    // A reconnect (page reload, new tab) hits this route without ever going through POST /join — the
    // same self-healing check belongs here too, or a guest who's only ever reconnected stays invisible
    // to draft() forever.
    if (settings.mode === "rotation") ensureRotationState(room.id, guest.id);

    // Guests who joined before token mode existed have no ledger history yet —
    // back-fill their start grant lazily instead of showing a false zero balance.
    let guestBalance = balance(guest.id);
    if (history(guest.id).length === 0) {
      const grant = apply({
        roomId: room.id,
        guestId: guest.id,
        delta: settings.startTokens,
        reason: "start",
        cap: settings.tokenCap,
      });
      guestBalance = grant.balance;
    }

    return { guest: serializeGuest(guest, guestBalance) };
  });

  app.get<{ Params: { code: string } }>("/rooms/:code/me/tokens", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });

    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });

    return {
      activity: getGuestTokenActivity(guest.id),
      songsAdded: countSongsAddedBy(room.id, guest.id),
      reactionsGot: reactionsReceivedBy(room.id, guest.id),
      aiNickname: guestNickname(room.id, guest.id),
    };
  });

  app.get<{ Params: { code: string } }>("/rooms/:code/me/labels", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    return guestLabels(room, guest.id);
  });

  // A fun little feature: any guest can blast a short message to the whole room (TV + every phone),
  // unless staff has taken the ability away from them specifically (they're still muted from adding
  // songs, reacting, voting etc. by the usual mute — this is a separate toggle).
  app.post<{ Params: { code: string }; Body: { message?: string } }>(
    "/rooms/:code/announce",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });
      if (!guest.canAnnounce) return reply.code(403).send({ error: "not_allowed" });

      const cooldownMs = announcementCooldownLeft(lastAnnouncementAt.get(guest.id), Date.now());
      if (cooldownMs > 0) return reply.code(429).send({ error: "cooldown", retryAfterMs: cooldownMs });

      const checked = checkAnnouncement(req.body?.message);
      if (!checked.ok) {
        return reply.code(400).send({ error: "announcement_rejected", reason: checked.error });
      }
      lastAnnouncementAt.set(guest.id, Date.now());

      const io = getIO();
      const toast: ToastPayload = {
        id: crypto.randomUUID(),
        emoji: "📣",
        message: `${guest.nickname}: ${checked.text}`,
        guestVisible: true,
      };
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, toast);
      recordAction(io, room, { actor: guest.id, action: "announce", detail: `"${checked.text}"` });

      return { ok: true };
    },
  );

  app.patch<{ Params: { code: string }; Body: IdentityBody }>(
    "/rooms/:code/me",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });

      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });

      const nickname = (typeof req.body?.nickname === "string" ? req.body.nickname : guest.nickname).trim().slice(0, 20);
      const emoji = req.body?.emoji ?? guest.emoji;
      if (nickname.length < 1) return reply.code(400).send({ error: "invalid_nickname" });
      if (!GUEST_EMOJI.includes(emoji as (typeof GUEST_EMOJI)[number])) {
        return reply.code(400).send({ error: "invalid_emoji" });
      }

      const lastChange = lastIdentityChangeAt.get(guest.id);
      const now = Date.now();
      if (lastChange && now - lastChange < IDENTITY_CHANGE_COOLDOWN_MS) {
        return reply.code(429).send({
          error: "identity_change_cooldown",
          retryAfterMs: IDENTITY_CHANGE_COOLDOWN_MS - (now - lastChange),
        });
      }

      const updated = updateGuestIdentity(guest, nickname, emoji);
      lastIdentityChangeAt.set(guest.id, now);

      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));

      return { guest: serializeGuest(updated, balance(guest.id)) };
    },
  );
};
