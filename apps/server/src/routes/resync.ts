import type { FastifyPluginAsync } from "fastify";
import { getRoomByCode } from "../db/rooms.js";
import { requirePerm } from "../auth-helpers.js";
import { recordAction } from "../realtime/action-log-broadcast.js";
import { getIO } from "../realtime/io-instance.js";
import { checkQueueDrift, fixQueueDrift, broadcastQueueWarning } from "../realtime/queue-resync.js";

export const resyncRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string } }>("/rooms/:code/resync", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (!requirePerm(req, room, "skip")) return reply.code(403).send({ error: "not_allowed" });

    try {
      const foreignAhead = await checkQueueDrift(room);
      broadcastQueueWarning(room, foreignAhead);
      return { foreignAhead };
    } catch (err) {
      req.log.error(err, "resync check failed");
      return reply.code(502).send({ error: "spotify_unavailable" });
    }
  });

  app.post<{ Params: { code: string } }>("/rooms/:code/resync/fix", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requirePerm(req, room, "skip");
    if (!actor) return reply.code(403).send({ error: "not_allowed" });

    try {
      const skipped = await fixQueueDrift(room);
      if (skipped > 0) {
        recordAction(getIO(), room, {
          actor: actor.hostId ?? actor.guestId!,
          action: "resync",
          detail: `the queue (skipped past ${skipped} Spotify-only song${skipped === 1 ? "" : "s"})`,
        });
      }
      return { ok: true, skipped };
    } catch (err) {
      req.log.error(err, "resync fix failed");
      return reply.code(502).send({ error: "spotify_unavailable" });
    }
  });
};
