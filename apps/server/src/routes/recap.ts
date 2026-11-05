import type { FastifyPluginAsync } from "fastify";
import { getRoomByCode } from "../db/rooms.js";
import { getAuthenticatedHost } from "../auth-helpers.js";
import { buildRecap } from "../db/recap.js";
import { recapKey, recapKeyValid } from "../recap-access.js";

export const recapRoutes: FastifyPluginAsync = async (app) => {
  // The recap as data. The host can read it any time (a live preview during the night); everyone else needs the
  // key from the recap link, and only once the night has ended.
  app.get<{ Params: { code: string }; Querystring: { key?: string } }>("/rooms/:code/recap.json", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const host = getAuthenticatedHost(req);
    const isHost = !!host && host.id === room.hostId;
    if (!isHost && !(room.status === "ended" && recapKeyValid(room, req.query.key))) {
      return reply.code(404).send({ error: "room_not_found" }); // same answer as a wrong code: nothing to learn
    }
    const recap = buildRecap(room.id);
    if (!recap) return reply.code(404).send({ error: "room_not_found" });
    return { recap, key: isHost ? recapKey(room) : undefined };
  });
};
