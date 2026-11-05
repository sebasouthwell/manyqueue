import type { FastifyPluginAsync } from "fastify";
import { SOCKET_EVENTS, VOTE_SKIP_OPENS_AFTER_MS, type VoteTallyPayload } from "@manyqueue/shared";
import { getRoomByCode } from "../db/rooms.js";
import { getActiveQueueItems } from "../db/queue.js";
import {
  getOpenVote,
  getOrCreateOpenVote,
  toggleBallot,
  countBallots,
  closeVote,
  hasBallot,
} from "../db/votes.js";
import { getActiveGuest, getAuthenticatedGuestId } from "../auth-helpers.js";
import { getRoomSettings } from "../db/settings.js";
import { getIO } from "../realtime/io-instance.js";
import { getActiveGuestCount, roomChannel } from "../realtime/socket-server.js";
import { forceSkipCurrent } from "../realtime/playback-control.js";
import { recordAction } from "../realtime/action-log-broadcast.js";

/** A floor of 3 votes always applies underneath the percent, so a
 * near-empty room can't be skip-bombed by one or two people. */
function voteThreshold(activeGuestCount: number, skipVotePercent: number): number {
  return Math.max(3, Math.ceil((skipVotePercent / 100) * activeGuestCount));
}

function votingOpensInMs(startedAt: Date | null): number {
  if (!startedAt) return VOTE_SKIP_OPENS_AFTER_MS;
  return Math.max(0, VOTE_SKIP_OPENS_AFTER_MS - (Date.now() - startedAt.getTime()));
}

export const voteRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { code: string }; Body: { type?: "skip" } }>(
    "/rooms/:code/votes",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });

      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });
      const guestId = guest.id;

      if (req.body?.type !== "skip") return reply.code(400).send({ error: "invalid_vote_type" });

      const active = getActiveQueueItems(room.id);
      const current = active.find((item) => item.status === "playing");
      if (!current) return reply.code(400).send({ error: "nothing_playing" });

      if (votingOpensInMs(current.startedAt) > 0) {
        return reply.code(403).send({
          error: "voting_not_open_yet",
          opensInMs: votingOpensInMs(current.startedAt),
        });
      }

      const vote = getOrCreateOpenVote(room.id, current.id, "skip");
      const voted = toggleBallot(vote.id, guestId);
      const count = countBallots(vote.id);
      const io = getIO();
      const settings = getRoomSettings(room.id);
      const threshold = voteThreshold(getActiveGuestCount(io, room.code), settings.skipVotePercent);

      const skipped = count >= threshold;
      if (skipped) {
        closeVote(vote.id);
        await forceSkipCurrent(room, "💀 Skipped by the crowd");
        recordAction(io, room, { actor: "system", action: "skip", detail: `"${current.trackName}" (crowd vote)` });
      }

      const tally: VoteTallyPayload = {
        targetQueueItemId: current.id,
        count: skipped ? 0 : count,
        threshold,
        skipped,
      };
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.VOTE_TALLY, tally);

      return { voted, count, threshold, skipped };
    },
  );

  app.get<{ Params: { code: string } }>("/rooms/:code/votes/current", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });

    const current = getActiveQueueItems(room.id).find((item) => item.status === "playing");
    if (!current) return { vote: null };

    const guestId = getAuthenticatedGuestId(req);
    const vote = getOpenVote(room.id, current.id, "skip");
    const count = vote ? countBallots(vote.id) : 0;
    const settings = getRoomSettings(room.id);
    const threshold = voteThreshold(getActiveGuestCount(getIO(), room.code), settings.skipVotePercent);

    return {
      vote: {
        targetQueueItemId: current.id,
        count,
        threshold,
        voted: vote && guestId ? hasBallot(vote.id, guestId) : false,
        votingOpensInMs: votingOpensInMs(current.startedAt),
      },
    };
  });
};
