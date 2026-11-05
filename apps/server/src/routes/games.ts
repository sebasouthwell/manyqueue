import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import { getIO } from "../realtime/io-instance.js";
import { recordAction } from "../realtime/action-log-broadcast.js";
import { endContestNow } from "../realtime/contest.js";
import { gamesHistory, gamesState, liveGameFor } from "../realtime/games.js";
import { getVoteEngine } from "../realtime/votes.js";

export const gamesRoutes: FastifyPluginAsync = async (app) => {
  // Host and co-hosts: what's live, the contest pool, and how the night's games went.
  app.get<{ Params: { code: string } }>("/rooms/:code/games", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (!requireRole(req, room, "cohost")) return reply.code(403).send({ error: "not_allowed" });
    return { state: gamesState(room), history: gamesHistory(room) };
  });

  // End whatever vote is live, right now, on the votes cast so far. (Vetoing a ban is host-only, and is its own route.)
  app.post<{ Params: { code: string } }>("/rooms/:code/games/end", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requireRole(req, room, "cohost");
    if (!actor) return reply.code(403).send({ error: "not_allowed" });

    const live = liveGameFor(room);
    if (!live) return reply.code(409).send({ error: "no_live_game" });

    if (live.type === "contest") endContestNow(room);
    else getVoteEngine().closeNow(live.voteId);

    const action = live.type === "contest" ? "contest_end" : live.type === "ban" ? "ban_end" : "guess_end";
    recordAction(getIO(), room, { actor: actor.hostId ?? actor.guestId!, action });
    return { ok: true };
  });
};
