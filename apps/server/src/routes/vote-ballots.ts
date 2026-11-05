import type { FastifyPluginAsync } from "fastify";
import { getRoomByCode } from "../db/rooms.js";
import { getVoteById } from "../db/votes.js";
import { getActiveGuest, requireRole } from "../auth-helpers.js";
import { getVoteEngine } from "../realtime/votes.js";
import { getPlayingItem } from "../db/queue.js";
import { finishMysteryPick, startCasualGuess, startGuessVote } from "../realtime/guess.js";
import { onSongStarted } from "../realtime/song-events.js";
import { getIO } from "../realtime/io-instance.js";

const STATUS: Record<string, number> = {
  vote_not_found: 404,
  vote_closed: 409,
  invalid_option: 400,
  not_in_room: 403,
  not_allowed: 403,
  already_voted: 409,
};

export const voteBallotRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { code: string; id: string }; Body: { optionId?: string } }>(
    "/rooms/:code/votes/:id/ballot",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });
      const optionId = req.body?.optionId;
      if (typeof optionId !== "string") return reply.code(400).send({ error: "invalid_option" });

      const vote = getVoteById(req.params.id);
      if (!vote || vote.roomId !== room.id) return reply.code(404).send({ error: "vote_not_found" });

      const outcome = getVoteEngine().cast(vote.id, guest.id, optionId);
      if (!outcome.ok) {
        return reply
          .code(STATUS[outcome.error] ?? 400)
          .send({ error: outcome.error, ...(outcome.reason ? { reason: outcome.reason } : {}) });
      }
      return { ok: true, optionId };
    },
  );

  // Dev aid (never in production): open a 30s contest between two dummy
  // options so the vote UI and the restart-survival can be tried without a game.
  if (process.env.NODE_ENV !== "production") {
    app.post<{ Params: { code: string }; Body: { seconds?: number } }>(
      "/rooms/:code/votes/test",
      async (req, reply) => {
        const room = getRoomByCode(req.params.code);
        if (!room) return reply.code(404).send({ error: "room_not_found" });
        if (!requireRole(req, room, "host")) return reply.code(403).send({ error: "not_allowed" });
        const seconds = Math.min(300, Math.max(3, Number(req.body?.seconds) || 30));
        const vote = getVoteEngine().open({
          roomId: room.id,
          type: "contest",
          title: "Test vote: which is better?",
          instruction: "Tap one",
          options: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" },
          ],
          durationMs: seconds * 1000,
        });
        return { id: vote.id, deadlineAt: vote.deadlineAt };
      },
    );

    // Dev aid: what the player loop does when a song starts / ends, without a real player.
    app.post<{ Params: { code: string }; Body: { action?: "start" | "finish" | "casual" | "song-start" } }>(
      "/rooms/:code/dev/mystery",
      async (req, reply) => {
        const room = getRoomByCode(req.params.code);
        if (!room) return reply.code(404).send({ error: "room_not_found" });
        if (!requireRole(req, room, "host")) return reply.code(403).send({ error: "not_allowed" });
        const playing = getPlayingItem(room.id);
        if (!playing) return reply.code(400).send({ error: "nothing_playing" });
        if (req.body?.action === "finish") finishMysteryPick(getIO(), room, playing.id);
        else if (req.body?.action === "song-start") onSongStarted(getIO(), room, playing, () => 0.99);
        else if (req.body?.action === "casual") startCasualGuess(getIO(), room, playing);
        else startGuessVote(getIO(), room, playing);
        return { ok: true };
      },
    );
  }
};
