import type { FastifyPluginAsync } from "fastify";
import {
  SOCKET_EVENTS,
  queueAddPrice,
  isUnaffordableForever,
  songRuleViolation,
  cooldownRemainingMs,
  ANONYMOUS_COST,
  checkDedication,
  DEDICATION_COST,
  type AddToQueueResponse,
  type NoTokensResponse,
  type MaxReplaysResponse,
  type PriceChangedResponse,
  type TokenUpdatePayload,
} from "@manyqueue/shared";
import { getRoomByCode } from "../db/rooms.js";
import { isTrackInPool } from "../db/contest.js";
import { isTrackBanned } from "../db/bans.js";
import {
  addPaidQueueItem,
  addQueueItem,
  findActiveItemByTrackUri,
  countPlaysTonight,
  getLastAddedAtMs,
  getQueueItemById,
  addHeartIfAbsent,
  serializeQueue,
  serializeHistory,
} from "../db/queue.js";
import { getRoomSettings } from "../db/settings.js";
import { getTrackInfo } from "../spotify.js";
import { balance, InsufficientTokensError } from "../db/tokens.js";
import { getIO } from "../realtime/io-instance.js";
import { emitToGuest, roomChannel } from "../realtime/socket-server.js";
import { maybeApplyFairOrder, maybeRecomputeApprovalLockAt } from "../realtime/queue-recompute.js";
import { getActiveGuest, getAuthenticatedHost } from "../auth-helpers.js";

interface AddBody {
  trackUri?: string;
  name?: string;
  artistName?: string;
  albumArtUrl?: string | null;
  durationMs?: number;
  explicit?: boolean;
  expectedCost?: number;
  /** Optional "for Sam 🎂" line; costs one extra token when tokens are on. */
  dedication?: string | null;
  /** Queue it as a mystery pick (+1 token, +1 back if nobody guesses). */
  anonymous?: boolean;
}

export const queueRoutes: FastifyPluginAsync = async (app) => {
  // Public like the live queue: everyone in the room can see what already played.
  app.get<{ Params: { code: string } }>("/rooms/:code/history", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    return { history: serializeHistory(room.id) };
  });

  app.get<{ Params: { code: string } }>("/rooms/:code/queue", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    return { queue: serializeQueue(room.id) };
  });

  app.post<{ Params: { code: string }; Body: AddBody }>(
    "/rooms/:code/queue",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });

      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });
      const guestId = guest.id;
      if (guest.muted) return reply.code(403).send({ error: "muted" });

      const { trackUri, name, artistName, albumArtUrl, durationMs, expectedCost, explicit, dedication, anonymous: wantsAnonymous } = req.body ?? {};
      if (!trackUri || !name || !artistName || typeof durationMs !== "number") {
        return reply.code(400).send({ error: "invalid_track" });
      }

      const existing = findActiveItemByTrackUri(room.id, trackUri);
      if (existing) {
        const queue = serializeQueue(room.id);
        const item = queue.find((q) => q.id === existing.id)!;
        return { status: "duplicate", item } satisfies AddToQueueResponse;
      }

      if (isTrackBanned(room.id, trackUri)) return reply.code(400).send({ error: "banned" });
      if (isTrackInPool(room.id, trackUri)) return reply.code(400).send({ error: "in_contest_pool" });

      const settings = getRoomSettings(room.id);

      // Song rules: re-check against Spotify rather than trusting the
      // duration/explicit values the phone sent; fall back to the client's
      // only if Spotify can't be reached.
      if (settings.maxSongMin !== null || !settings.explicit) {
        const info = await getTrackInfo(room.hostId, trackUri).catch(() => null);
        const violation = songRuleViolation(
          info ?? { durationMs, explicit: !!explicit },
          settings,
        );
        if (violation) return reply.code(400).send({ error: "rule_violation", rule: violation });
      }

      const cooldownMs = cooldownRemainingMs(
        getLastAddedAtMs(room.id, guestId),
        settings.addCooldownSec,
        Date.now(),
      );
      if (cooldownMs > 0) {
        return reply.code(429).send({ error: "cooldown", retryAfterMs: cooldownMs });
      }

      let dedicationText: string | null = null;
      if (dedication !== undefined && dedication !== null && dedication !== "") {
        const checked = checkDedication(dedication);
        if (!checked.ok) {
          return reply.code(400).send({ error: "dedication_rejected", reason: checked.error, message: checked.error === "too_long" ? "That dedication is too long." : "Write a dedication or turn it off." });
        }
        dedicationText = checked.text;
      }

      const playsTonight = countPlaysTonight(room.id, trackUri);
      const songCost = queueAddPrice(settings, playsTonight);
      const dedicationCost = dedicationText && settings.tokenMode ? DEDICATION_COST : 0;
      // Guess Who mode makes every pick a (free) mystery; otherwise it's the guest's choice and costs a token.
      const anonymous = settings.guessWhoMode || wantsAnonymous === true;
      const anonymousCost = anonymous && !settings.guessWhoMode && settings.tokenMode ? ANONYMOUS_COST : 0;
      const cost = songCost + dedicationCost + anonymousCost;

      if (settings.tokenMode && isUnaffordableForever(cost, settings.tokenCap)) {
        return reply.code(402).send({
          error: "max_replays",
          cost,
          tokenCap: settings.tokenCap,
        } satisfies MaxReplaysResponse);
      }

      if (typeof expectedCost === "number" && expectedCost !== cost) {
        return reply.code(409).send({
          error: "price_changed",
          cost,
          balance: balance(guestId),
        } satisfies PriceChangedResponse);
      }

      try {
        addPaidQueueItem({
          roomId: room.id,
          trackUri,
          trackName: name,
          artistName,
          albumArtUrl: albumArtUrl ?? null,
          durationMs,
          addedBy: guestId,
          cost,
          playsTonight,
          tokenCap: settings.tokenCap,
          pending: settings.approvals,
          dedication: dedicationText,
          dedicationCost,
          anonymous,
          anonymousCost,
        });
      } catch (err) {
        if (err instanceof InsufficientTokensError) {
          return reply.code(402).send({
            error: "no_tokens",
            cost,
            balance: balance(guestId),
          } satisfies NoTokensResponse);
        }
        throw err;
      }

      maybeApplyFairOrder(room);
      maybeRecomputeApprovalLockAt(room);

      const queue = serializeQueue(room.id);
      const item = queue.find((q) => q.trackUri === trackUri)!;

      getIO().to(`room:${room.code}`).emit(SOCKET_EVENTS.QUEUE_UPDATE, queue);

      if (cost > 0) {
        const payload: TokenUpdatePayload = {
          guestId,
          balance: balance(guestId),
          delta: -cost,
          reason: "queue_add",
        };
        emitToGuest(getIO(), room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
      }

      return { status: "added", item } satisfies AddToQueueResponse;
    },
  );

  // Host adds are always free — the host doesn't have a guest token balance
  // to charge, and shouldn't need one just to queue a song themselves.
  app.post<{ Params: { code: string }; Body: AddBody }>(
    "/rooms/:code/queue/host-add",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });
      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });
      if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });

      const { trackUri, name, artistName, albumArtUrl, durationMs, dedication } = req.body ?? {};
      if (!trackUri || !name || !artistName || typeof durationMs !== "number") {
        return reply.code(400).send({ error: "invalid_track" });
      }

      // Free: the host has no token balance to spend from, and it's their own party.
      let dedicationText: string | null = null;
      if (dedication !== undefined && dedication !== null && dedication !== "") {
        const checked = checkDedication(dedication);
        if (!checked.ok) {
          return reply.code(400).send({ error: "dedication_rejected", reason: checked.error, message: checked.error === "too_long" ? "That dedication is too long." : "Write a dedication or turn it off." });
        }
        dedicationText = checked.text;
      }

      const existing = findActiveItemByTrackUri(room.id, trackUri);
      if (existing) {
        const queue = serializeQueue(room.id);
        const item = queue.find((q) => q.id === existing.id)!;
        return { status: "duplicate", item } satisfies AddToQueueResponse;
      }

      addQueueItem({
        roomId: room.id,
        trackUri,
        trackName: name,
        artistName,
        albumArtUrl: albumArtUrl ?? null,
        durationMs,
        addedBy: null,
        dedication: dedicationText,
      });

      maybeApplyFairOrder(room);
      maybeRecomputeApprovalLockAt(room);

      const queue = serializeQueue(room.id);
      const item = queue.find((q) => q.trackUri === trackUri)!;
      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, queue);

      return { status: "added", item } satisfies AddToQueueResponse;
    },
  );

  app.post<{ Params: { code: string; itemId: string } }>(
    "/rooms/:code/queue/:itemId/heart",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });

      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });

      const item = getQueueItemById(req.params.itemId);
      if (!item || item.roomId !== room.id) {
        return reply.code(404).send({ error: "item_not_found" });
      }

      addHeartIfAbsent(item.id, guest.id);

      const queue = serializeQueue(room.id);
      getIO().to(`room:${room.code}`).emit(SOCKET_EVENTS.QUEUE_UPDATE, queue);

      return { ok: true };
    },
  );
};
