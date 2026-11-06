import type { FastifyPluginAsync } from "fastify";
import { getRoomByCode } from "../db/rooms.js";
import { getGuestById } from "../db/guests.js";
import { requirePerm } from "../auth-helpers.js";
import { getIO } from "../realtime/io-instance.js";
import { isAiConfigured } from "../ai/provider.js";
import { approveNickname, hideNickname, regenerateNickname, staffNicknames } from "../realtime/ai-nicknames.js";

// Whoever approves songs or moderates (the host, co-hosts, or a guest holding one of those) runs the AI nicknames.
export const aiNicknameRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string } }>("/rooms/:code/ai-nicknames", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (!requirePerm(req, room, "approve", "moderation")) return reply.code(403).send({ error: "not_allowed" });
    return { available: isAiConfigured(), nicknames: staffNicknames(room.id) };
  });

  for (const action of ["approve", "hide"] as const) {
    app.post<{ Params: { code: string; id: string } }>(`/rooms/:code/ai-nicknames/:id/${action}`, async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      if (!requirePerm(req, room, "approve", "moderation")) return reply.code(403).send({ error: "not_allowed" });
      const done = action === "approve" ? approveNickname(getIO(), room, req.params.id) : hideNickname(getIO(), room, req.params.id);
      if (!done) return reply.code(404).send({ error: "nickname_not_found" });
      return { ok: true };
    });
  }

  app.post<{ Params: { code: string; guestId: string } }>("/rooms/:code/guests/:guestId/ai-nickname/regenerate", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (!requirePerm(req, room, "approve", "moderation")) return reply.code(403).send({ error: "not_allowed" });
    const guest = getGuestById(req.params.guestId);
    if (!guest || guest.roomId !== room.id) return reply.code(404).send({ error: "guest_not_found" });
    const result = await regenerateNickname(getIO(), room, guest.id);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return { ok: true, made: result.proposals.length };
  });
};
