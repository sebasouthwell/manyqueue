import type { FastifyPluginAsync } from "fastify";
import {
  SOCKET_EVENTS,
  PERMISSION_LABELS,
  sanitizePermissions,
  type GuestSummary,
  type Permission,
  type RoleChangedPayload,
  type ToastPayload,
} from "@manyqueue/shared";
import { getAuthenticatedHost, requirePerm, requireStaff } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import { getGuestsForRoom, getGuestById, setGuestRole, setGuestPerms } from "../db/guests.js";
import { getRecentActionLog } from "../db/action-log.js";
import { getRoomSettings } from "../db/settings.js";
import { balance } from "../db/tokens.js";
import { latestNicknameFor, shownNicknameFor } from "../db/ai-nicknames.js";
import { getIO } from "../realtime/io-instance.js";
import { roomChannel, emitToGuest } from "../realtime/socket-server.js";
import { recordAction } from "../realtime/action-log-broadcast.js";

function serializeGuestSummary(
  guest: {
    id: string;
    nickname: string;
    emoji: string;
    role: "guest" | "cohost";
    muted: boolean;
    perms: Permission[];
    canAnnounce: boolean;
  },
  tokenBalance: number | null,
  roomId?: string,
): GuestSummary {
  // What the guest shows now; failing that, whatever is waiting or was hidden.
  const ai = roomId ? (shownNicknameFor(roomId, guest.id) ?? latestNicknameFor(roomId, guest.id)) : undefined;
  return {
    id: guest.id,
    nickname: guest.nickname,
    emoji: guest.emoji,
    role: guest.role,
    muted: guest.muted,
    perms: guest.perms ?? [],
    canAnnounce: guest.canAnnounce,
    tokenBalance,
    aiNickname: ai ? { id: ai.id, nickname: ai.nickname, why: ai.why, status: ai.status } : null,
  };
}

export const roleRoutes: FastifyPluginAsync = async (app) => {
  // Cohosts need this too — they can't grant tokens without seeing who's here.
  app.get<{ Params: { code: string } }>("/rooms/:code/guests", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requirePerm(req, room, "tokens", "moderation");
    if (!actor) return reply.code(403).send({ error: "not_allowed" });

    const tokenMode = getRoomSettings(room.id).tokenMode;
    const guests = getGuestsForRoom(room.id).map((g) =>
      serializeGuestSummary(g, tokenMode ? balance(g.id) : null, room.id),
    );
    return { guests };
  });

  app.post<{ Params: { code: string; guestId: string }; Body: { role?: "guest" | "cohost" } }>(
    "/rooms/:code/guests/:guestId/role",
    async (req, reply) => {
      // Only the host promotes/demotes — not even a co-host can do this to
      // another guest (or to themselves).
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });
      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      const role = req.body?.role;
      if (role !== "guest" && role !== "cohost") {
        return reply.code(400).send({ error: "invalid_role" });
      }

      const guest = getGuestById(req.params.guestId);
      if (!guest || guest.roomId !== room.id) return reply.code(404).send({ error: "guest_not_found" });

      setGuestRole(guest.id, role);

      const io = getIO();
      const payload: RoleChangedPayload = { guestId: guest.id, role, perms: guest.perms ?? [] };
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.ROLE_CHANGED, payload);

      recordAction(io, room, {
        actor: host.id,
        action: role === "cohost" ? "promote" : "demote",
        target: guest.id,
        detail: guest.nickname,
      });

      if (role === "cohost") {
        const privateToast: ToastPayload = {
          id: crypto.randomUUID(),
          message: "⭐ You're a co-host now",
          guestVisible: true,
        };
        emitToGuest(io, room.code, guest.id, SOCKET_EVENTS.TOAST, privateToast);
      }

      const publicToast: ToastPayload = {
        id: crypto.randomUUID(),
        guestVisible: true,
        message:
          role === "cohost"
            ? `⭐ ${guest.nickname} is now a co-host`
            : `${guest.nickname} is no longer a co-host`,
        emoji: role === "cohost" ? guest.emoji : undefined,
      };
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, publicToast);

      const tokenMode = getRoomSettings(room.id).tokenMode;
      return {
        guest: serializeGuestSummary({ ...guest, role }, tokenMode ? balance(guest.id) : null, room.id),
      };
    },
  );

  // Host only: hand one guest specific permissions without making them a co-host.
  app.post<{ Params: { code: string; guestId: string }; Body: { perms?: unknown } }>(
    "/rooms/:code/guests/:guestId/perms",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });
      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      if (!Array.isArray(req.body?.perms)) return reply.code(400).send({ error: "invalid_perms" });
      const perms = sanitizePermissions(req.body.perms);

      const guest = getGuestById(req.params.guestId);
      if (!guest || guest.roomId !== room.id || guest.kickedAt) {
        return reply.code(404).send({ error: "guest_not_found" });
      }

      const before = guest.perms ?? [];
      setGuestPerms(guest.id, perms);

      const io = getIO();
      const payload: RoleChangedPayload = { guestId: guest.id, role: guest.role, perms };
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.ROLE_CHANGED, payload);

      const gained = perms.filter((p) => !before.includes(p));
      if (gained.length > 0) {
        const toast: ToastPayload = {
          id: crypto.randomUUID(),
          message: `You can now: ${gained.map((p) => PERMISSION_LABELS[p]).join(", ")}`,
          emoji: "🔑",
          guestVisible: true,
        };
        emitToGuest(io, room.code, guest.id, SOCKET_EVENTS.TOAST, toast);
      }

      recordAction(io, room, {
        actor: host.id,
        action: "perms",
        target: guest.id,
        detail: `${guest.nickname}: ${perms.length ? perms.map((p) => PERMISSION_LABELS[p]).join(", ") : "none"}`,
      });

      const tokenMode = getRoomSettings(room.id).tokenMode;
      return { guest: serializeGuestSummary({ ...guest, perms }, tokenMode ? balance(guest.id) : null, room.id) };
    },
  );

  app.get<{ Params: { code: string }; Querystring: { limit?: string } }>(
    "/rooms/:code/action-log",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requireStaff(req, room);
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      const limit = Math.min(50, Number(req.query.limit ?? "20") || 20);
      return { entries: getRecentActionLog(room, limit) };
    },
  );
};
