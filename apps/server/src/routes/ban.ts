import type { FastifyPluginAsync } from "fastify";
import { getActiveGuest, getAuthenticatedHost } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import { getIO } from "../realtime/io-instance.js";
import { banCooldownFor, callBan, getRunningBan, vetoBan } from "../realtime/ban.js";
import { gameSpacing } from "../realtime/game-rules.js";

export const banRoutes: FastifyPluginAsync = async (app) => {
  // When this guest may next call a ban vote (for the add sheet's "Available in 6 min").
  app.get<{ Params: { code: string } }>("/rooms/:code/ban/status", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    return { retryAfterMs: banCooldownFor(room, guest.id), running: !!getRunningBan(room.id), spacingSongs: gameSpacing(room).songsUntil };
  });

  app.post<{ Params: { code: string }; Body: { queueItemId?: string } }>("/rooms/:code/ban/call", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    if (guest.muted) return reply.code(403).send({ error: "muted" });
    if (typeof req.body?.queueItemId !== "string") return reply.code(400).send({ error: "invalid_target" });

    const result = callBan(getIO(), room, guest.id, req.body.queueItemId);
    if (!result.ok) {
      const status = result.error === "cooldown" ? 429 : 409;
      return reply.code(status).send({ error: result.error, ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}) });
    }
    return { ok: true, voteId: result.voteId };
  });

  // Only the host can veto: the room's call is overruled, and the song stays.
  app.post<{ Params: { code: string } }>("/rooms/:code/ban/veto", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });
    const room = getRoomByCode(req.params.code);
    if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });
    if (!vetoBan(getIO(), room, host.id)) return reply.code(409).send({ error: "no_ban_vote" });
    return { ok: true };
  });
};
