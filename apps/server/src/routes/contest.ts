import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import {
  CONTEST_BLOCKER_TEXT,
  CONTEST_ENTRY_COST,
  SOCKET_EVENTS,
  songRuleViolation,
  type ToastPayload,
  type TokenUpdatePayload,
} from "@manyqueue/shared";
import { getActiveGuest, requireRole } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { findActiveItemByTrackUri, getQueueItemById } from "../db/queue.js";
import { leaveFight } from "../db/fight.js";
import { broadcastRotationState } from "../realtime/rotation-views.js";
import { InsufficientTokensError, balance } from "../db/tokens.js";
import {
  AlreadyInPoolError,
  enterContestPool,
  getPoolEntry,
  isTrackInPool,
  removePoolEntry,
} from "../db/contest.js";
import { getTrackInfo } from "../spotify.js";
import { isTrackBanned } from "../db/bans.js";
import { getIO } from "../realtime/io-instance.js";
import { emitToGuest } from "../realtime/socket-server.js";
import { recordAction } from "../realtime/action-log-broadcast.js";
import {
  broadcastContestPool,
  contestPoolPayload,
  endContestNow,
  getRunningContest,
  startContest,
} from "../realtime/contest.js";

interface EnterBody {
  trackUri?: string;
  name?: string;
  artistName?: string;
  albumArtUrl?: string | null;
  durationMs?: number;
  explicit?: boolean;
}

export const contestRoutes: FastifyPluginAsync = async (app) => {
  // A guest puts a song in the pool instead of the queue. One token, back if it wins.
  app.post<{ Params: { code: string }; Body: EnterBody }>("/rooms/:code/contest/enter", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    const guestId = guest.id;
    if (guest.muted) return reply.code(403).send({ error: "muted" });
    // Rotation mode has Fight for a spot instead, from a song already in your own queue.
    if (getRoomSettings(room.id).mode === "rotation") return reply.code(400).send({ error: "use_fight" });

    const { trackUri, name, artistName, albumArtUrl, durationMs, explicit } = req.body ?? {};
    if (!trackUri || !name || !artistName || typeof durationMs !== "number") {
      return reply.code(400).send({ error: "invalid_track" });
    }
    if (isTrackBanned(room.id, trackUri)) return reply.code(400).send({ error: "banned" });
    if (findActiveItemByTrackUri(room.id, trackUri) || isTrackInPool(room.id, trackUri)) {
      return reply.code(409).send({ error: "duplicate" });
    }

    const settings = getRoomSettings(room.id);
    if (settings.maxSongMin !== null || !settings.explicit) {
      const info = await getTrackInfo(room.hostId, trackUri).catch(() => null);
      const violation = songRuleViolation(info ?? { durationMs, explicit: !!explicit }, settings);
      if (violation) return reply.code(400).send({ error: "rule_violation", rule: violation });
    }

    const cost = settings.tokenMode ? CONTEST_ENTRY_COST : 0;
    let entered;
    try {
      entered = enterContestPool({
        roomId: room.id,
        guestId,
        trackUri,
        trackName: name,
        artistName,
        albumArtUrl: albumArtUrl ?? null,
        durationMs,
        cost,
        tokenCap: settings.tokenCap,
        anonymous: settings.guessWhoMode,
      });
    } catch (err) {
      if (err instanceof AlreadyInPoolError) return reply.code(409).send({ error: "already_entered" });
      if (err instanceof InsufficientTokensError) {
        return reply.code(402).send({ error: "no_tokens", cost, balance: balance(guestId) });
      }
      throw err;
    }

    const io = getIO();
    if (cost > 0 && entered.balance !== null) {
      const payload: TokenUpdatePayload = { guestId, balance: entered.balance, delta: -cost, reason: "contest_entry" };
      emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
    }
    broadcastContestPool(io, room);
    return { status: "entered", entryId: entered.entry.id };
  });

  // Host and co-hosts: the pool, and whether a contest could start right now.
  app.get<{ Params: { code: string } }>("/rooms/:code/contest", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (!requireRole(req, room, "cohost")) return reply.code(403).send({ error: "not_allowed" });
    return contestPoolPayload(room);
  });

  app.post<{ Params: { code: string }; Body: { entryIds?: string[] } }>("/rooms/:code/contest/start", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requireRole(req, room, "cohost");
    if (!actor) return reply.code(403).send({ error: "not_allowed" });
    if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });

    const ids = req.body?.entryIds;
    const pick = Array.isArray(ids) && ids.length === 2 && ids.every((i) => typeof i === "string") ? ([ids[0], ids[1]] as [string, string]) : undefined;
    if (ids !== undefined && !pick) return reply.code(400).send({ error: "invalid_entries" });

    const result = startContest(getIO(), room, pick);
    if (!result.ok) {
      const message = result.error === "invalid_entries" ? "Pick two songs from two different guests." : CONTEST_BLOCKER_TEXT[result.error];
      return reply.code(409).send({ error: result.error, message });
    }
    recordAction(getIO(), room, { actor: actor.hostId ?? actor.guestId!, action: "contest_start" });
    return { ok: true, voteId: result.voteId };
  });

  app.post<{ Params: { code: string } }>("/rooms/:code/contest/end", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requireRole(req, room, "cohost");
    if (!actor) return reply.code(403).send({ error: "not_allowed" });
    if (!getRunningContest(room.id)) return reply.code(409).send({ error: "no_contest" });

    endContestNow(room);
    recordAction(getIO(), room, { actor: actor.hostId ?? actor.guestId!, action: "contest_end" });
    return { ok: true };
  });

  // Pull a song out of the pool; its token goes back.
  app.delete<{ Params: { code: string; entryId: string } }>("/rooms/:code/contest/entries/:entryId", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requireRole(req, room, "cohost");
    if (!actor) return reply.code(403).send({ error: "not_allowed" });

    const entry = getPoolEntry(req.params.entryId);
    if (!entry || entry.roomId !== room.id) return reply.code(404).send({ error: "entry_not_found" });
    const running = getRunningContest(room.id);
    if (running && JSON.stringify(running.meta).includes(entry.id)) return reply.code(409).send({ error: "in_contest" });

    // A Rotation fight entry goes back to its owner's queue instead of being dropped.
    const fight = getQueueItemById(entry.queueItemId)?.status === "in_fight" ? leaveFight(entry.id, "refund_reject") : null;
    const removed = fight
      ? { item: fight.item, balance: fight.balance }
      : removePoolEntry(entry.id, "refund_reject", getRoomSettings(room.id).tokenCap);
    if (!removed) return reply.code(404).send({ error: "entry_not_found" });
    if (fight) broadcastRotationState(getIO(), room);

    const io = getIO();
    if (removed.balance !== null) {
      const payload: TokenUpdatePayload = { guestId: entry.enteredBy, balance: removed.balance, delta: fight ? fight.refunded : removed.item.paid, reason: "refund_reject" };
      emitToGuest(io, room.code, entry.enteredBy, SOCKET_EVENTS.TOKEN_UPDATE, payload);
    }
    const toast: ToastPayload = { id: crypto.randomUUID(), message: `Token refunded for "${removed.item.trackName}"`, guestVisible: true };
    emitToGuest(io, room.code, entry.enteredBy, SOCKET_EVENTS.TOAST, toast);
    recordAction(io, room, { actor: actor.hostId ?? actor.guestId!, action: "contest_remove", target: entry.enteredBy, detail: `"${removed.item.trackName}"` });
    broadcastContestPool(io, room);
    return { ok: true };
  });
};
