import type { FastifyPluginAsync } from "fastify";
import { SOCKET_EVENTS, type ToastPayload, type TokenUpdatePayload } from "@manyqueue/shared";
import { getAuthenticatedHost, requirePerm } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import {
  removeQueuedItem,
  refundQueueItem,
  moveQueueItem,
  pinQueueItemAtCurrentRank,
  approveQueueItem,
  serializeQueue,
  getQueueItemById,
  setDedicationHidden,
  getPlayingItem,
} from "../db/queue.js";
import { getRoomSettings } from "../db/settings.js";
import { apply, TokenCapExceededError, InsufficientTokensError } from "../db/tokens.js";
import { getGuestById } from "../db/guests.js";
import { applyLocalPlaybackChange, pokePlayerLoop, forgetRemovedItem } from "../realtime/player-loop.js";
import { pausePlayback, resumePlayback, setPlaybackVolume } from "../spotify.js";
import { updateRoomVolume } from "../realtime/volume.js";
import { forceSkipCurrent } from "../realtime/playback-control.js";
import { getIO } from "../realtime/io-instance.js";
import { roomChannel, emitToGuest } from "../realtime/socket-server.js";
import { maybePayPassiveIncome } from "../realtime/passive-income.js";
import { maybeApplyFairOrder, maybeRecomputeApprovalLockAt } from "../realtime/queue-recompute.js";
import { announceDedication, endMoment, dedicationMomentId } from "../realtime/moments.js";
import { recordAction, broadcastAction } from "../realtime/action-log-broadcast.js";
import { broadcastRotationState } from "../realtime/rotation-views.js";

export const hostControlRoutes: FastifyPluginAsync = async (app) => {
  // Hosts and co-hosts can hide (or restore) a dedication from the track panel
  // or an approval card. Hiding it also pulls it off the TV straight away.
  for (const hide of [true, false]) {
    app.post<{ Params: { code: string; itemId: string } }>(
      `/rooms/:code/queue/:itemId/dedication/${hide ? "hide" : "show"}`,
      async (req, reply) => {
        const room = getRoomByCode(req.params.code);
        if (!room) return reply.code(404).send({ error: "room_not_found" });
        const actor = requirePerm(req, room, "moderation");
        if (!actor) return reply.code(403).send({ error: "not_allowed" });

        const item = getQueueItemById(req.params.itemId);
        if (!item || item.roomId !== room.id || !item.dedication) {
          return reply.code(404).send({ error: "no_dedication" });
        }

        setDedicationHidden(item.id, hide);
        const io = getIO();
        io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
        if (hide) endMoment(io, room, dedicationMomentId(item.id));
        else announceDedication(io, room, { ...item, dedicationHidden: false });

        recordAction(io, room, {
          actor: actor.hostId ?? actor.guestId!,
          action: hide ? "dedication_hide" : "dedication_show",
          target: item.id,
          detail: `"${item.trackName}"`,
        });
        return { ok: true };
      },
    );
  }

  // Pause / resume: the host, co-hosts, or a guest holding "Pause/Play".
  for (const action of ["pause", "resume"] as const) {
    app.post<{ Params: { code: string } }>(`/rooms/:code/playback/${action}`, async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "playback");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });
      if (!room.deviceId) return reply.code(400).send({ error: "no_device" });

      const run = action === "pause" ? pausePlayback : resumePlayback;
      let accepted = true;
      await run(room.hostId, room.deviceId).catch((err) => {
        accepted = false;
        req.log.error(err, `${action} failed`);
      });
      // Spotify accepted it, so we know the new state without asking.
      // Pausing is exact. Resuming re-checks once, since the position it resumes from can differ a little.
      if (accepted) applyLocalPlaybackChange(room.code, action === "resume");
      if (!accepted || action === "resume") pokePlayerLoop(room.code);
      recordAction(getIO(), room, { actor: actor.hostId ?? actor.guestId!, action });
      return { ok: true };
    });
  }

  // Speaker volume (0-100): the host, co-hosts, or a guest holding "Volume".
  app.post<{ Params: { code: string }; Body: { percent?: number } }>(
    "/rooms/:code/playback/volume",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "volume");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      const percent = req.body?.percent;
      if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
        return reply.code(400).send({ error: "invalid_volume" });
      }
      if (!room.deviceId) return reply.code(400).send({ error: "no_device" });

      try {
        await setPlaybackVolume(room.hostId, room.deviceId, percent);
      } catch (err) {
        req.log.error(err, "volume failed");
        return reply.code(502).send({ error: "volume_failed" });
      }
      updateRoomVolume(getIO(), room.code, Math.round(percent));
      return { ok: true, percent: Math.round(percent) };
    },
  );

  app.post<{ Params: { code: string } }>("/rooms/:code/playback/skip", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requirePerm(req, room, "skip");
    if (!actor) return reply.code(403).send({ error: "not_allowed" });

    const playing = getPlayingItem(room.id); // named in the log: "Host skipped Hello", not just "Host skipped"
    const skipped = await forceSkipCurrent(room, "⏭️ Skipped");
    if (skipped) {
      recordAction(getIO(), room, { actor: actor.hostId ?? actor.guestId!, action: "skip", detail: playing ? `"${playing.trackName}"` : undefined });
    }
    return { ok: true, skipped };
  });

  app.delete<{ Params: { code: string; itemId: string } }>(
    "/rooms/:code/queue/:itemId",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "skip");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });
      // Item ids are public (anyone can read a queue), so the item must belong to this room.
      const target = getQueueItemById(req.params.itemId);
      if (!target || target.roomId !== room.id) return reply.code(404).send({ error: "not_found" });
      // Removing a song still waiting for approval is rejecting it: that's the approve permission.
      if (target.status === "pending" && !requirePerm(req, room, "approve")) return reply.code(403).send({ error: "not_allowed" });

      const removed = removeQueuedItem(req.params.itemId);
      if (!removed) return reply.code(400).send({ error: "cannot_remove" });
      forgetRemovedItem(room.code, removed.id);

      recordAction(getIO(), room, {
        actor: actor.hostId ?? actor.guestId!,
        action: "remove",
        target: removed.id,
        detail: `"${removed.trackName}"`,
      });

      if (removed.paid > 0 && removed.addedBy) {
        const settings = getRoomSettings(room.id);
        const newBalance = refundQueueItem(removed, "refund_reject", settings.tokenCap);
        if (newBalance !== null) {
          const guestId = removed.addedBy;
          const io = getIO();
          const payload: TokenUpdatePayload = {
            guestId,
            balance: newBalance,
            delta: removed.paid,
            reason: "refund_reject",
          };
          emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
          const toast: ToastPayload = {
            id: crypto.randomUUID(),
            message: `Token refunded for "${removed.trackName}"`,
            guestVisible: true,
          };
          emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOAST, toast);
        }
      }

      maybeApplyFairOrder(room);
      maybeRecomputeApprovalLockAt(room);
      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
      if (removed.status === "house") broadcastRotationState(getIO(), room);
      maybePayPassiveIncome(getIO(), room);
      return { ok: true };
    },
  );

  app.post<{ Params: { code: string; itemId: string }; Body: { direction?: "up" | "down" } }>(
    "/rooms/:code/queue/:itemId/move",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });
      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      const direction = req.body?.direction;
      if (direction !== "up" && direction !== "down") {
        return reply.code(400).send({ error: "invalid_direction" });
      }

      const moved = moveQueueItem(room.id, req.params.itemId, direction);
      if (!moved) return reply.code(400).send({ error: "cannot_move" });

      // A manual reorder is explicit host intent — pin it there so a later
      // fairOrder run (on the next add/remove/play) doesn't undo the move.
      pinQueueItemAtCurrentRank(req.params.itemId);
      maybeApplyFairOrder(room);
      maybeRecomputeApprovalLockAt(room);

      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
      return { ok: true };
    },
  );

  app.post<{ Params: { code: string; itemId: string } }>(
    "/rooms/:code/queue/:itemId/approve",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "approve");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      if (getQueueItemById(req.params.itemId)?.roomId !== room.id) return reply.code(404).send({ error: "not_found" });
      const approved = approveQueueItem(req.params.itemId, actor.hostId ?? actor.guestId!);
      if (!approved) return reply.code(400).send({ error: "cannot_approve" });

      broadcastAction(getIO(), room, {
        actor: actor.hostId ?? actor.guestId!,
        action: "approve",
        detail: `"${approved.trackName}"`,
      });

      maybeApplyFairOrder(room);
      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
      return { ok: true };
    },
  );

  app.post<{ Params: { code: string; itemId: string } }>(
    "/rooms/:code/queue/:itemId/reject",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "approve");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      // Reject is for songs waiting on approval; taking a queued song out is skip's job.
      const target = getQueueItemById(req.params.itemId);
      if (!target || target.roomId !== room.id) return reply.code(404).send({ error: "not_found" });
      if (target.status !== "pending") return reply.code(400).send({ error: "cannot_reject" });
      const removed = removeQueuedItem(req.params.itemId);
      if (!removed) return reply.code(400).send({ error: "cannot_reject" });

      recordAction(getIO(), room, {
        actor: actor.hostId ?? actor.guestId!,
        action: "reject",
        target: removed.id,
        detail: `"${removed.trackName}"`,
      });

      if (removed.paid > 0 && removed.addedBy) {
        const settings = getRoomSettings(room.id);
        const newBalance = refundQueueItem(removed, "refund_reject", settings.tokenCap);
        if (newBalance !== null) {
          const guestId = removed.addedBy;
          const io = getIO();
          const payload: TokenUpdatePayload = {
            guestId,
            balance: newBalance,
            delta: removed.paid,
            reason: "refund_reject",
          };
          emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
          const toast: ToastPayload = {
            id: crypto.randomUUID(),
            message: "Your song wasn't picked this time — token refunded.",
            guestVisible: true,
          };
          emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOAST, toast);
        }
      }

      maybeApplyFairOrder(room);
      maybeRecomputeApprovalLockAt(room);
      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));
      return { ok: true };
    },
  );

  // Co-hosts can only give away so many tokens per rolling hour (settings.cohostGrantHourlyLimit) — the
  // host has no limit; that guards the room's token economy. Penalties can't inflate the economy the
  // same way (they floor at 0), but nothing stopped a co-host hammering the same guest's balance to 0
  // over and over, so those get their own limit too (cohostPenaltyHourlyLimit) — a call count, not a
  // token total, since it's about spam rather than balance.
  const GRANT_WINDOW_MS = 60 * 60 * 1000;
  const grantHistoryByActor = new Map<string, { amount: number; at: number }[]>();

  function cohostActionsThisHour(actorId: string): { amount: number; at: number }[] {
    const now = Date.now();
    const history = (grantHistoryByActor.get(actorId) ?? []).filter(
      (e) => now - e.at < GRANT_WINDOW_MS,
    );
    grantHistoryByActor.set(actorId, history);
    return history;
  }

  app.post<{
    Params: { code: string; guestId: string };
    Body: { amount?: number; reason?: string; discreet?: boolean };
  }>(
    "/rooms/:code/guests/:guestId/grant",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "tokens");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      const amount = req.body?.amount;
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 60) : "";
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount === 0 ||
        Math.abs(amount) > 3
      ) {
        return reply.code(400).send({ error: "invalid_amount" });
      }

      const targetGuest = getGuestById(req.params.guestId);
      if (!targetGuest || targetGuest.roomId !== room.id) {
        return reply.code(404).send({ error: "guest_not_found" });
      }
      // Tokens are for handing out to others: a guest or co-host with the permission can't mint their own.
      if (actor.guestId && targetGuest.id === actor.guestId) {
        return reply.code(403).send({ error: "cannot_grant_self" });
      }

      const settings = getRoomSettings(room.id);
      const actorId = actor.hostId ?? actor.guestId!;
      if (actor.role !== "host") {
        const recent = cohostActionsThisHour(actorId);
        if (amount > 0) {
          const grantedSoFar = recent.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
          if (grantedSoFar + amount > settings.cohostGrantHourlyLimit) {
            return reply.code(429).send({
              error: "grant_limit_reached",
              grantedSoFar,
              limit: settings.cohostGrantHourlyLimit,
            });
          }
        } else {
          const penaltiesSoFar = recent.filter((e) => e.amount < 0).length;
          if (penaltiesSoFar >= settings.cohostPenaltyHourlyLimit) {
            return reply.code(429).send({
              error: "penalty_limit_reached",
              limit: settings.cohostPenaltyHourlyLimit,
            });
          }
        }
      }

      let grant;
      try {
        grant = apply({
          roomId: room.id,
          guestId: targetGuest.id,
          delta: amount,
          reason: amount > 0 ? "grant" : "penalty",
          actor: actorId,
          cap: settings.tokenCap,
        });
      } catch (err) {
        if (err instanceof TokenCapExceededError) return reply.code(400).send({ error: "at_cap" });
        if (err instanceof InsufficientTokensError) {
          return reply.code(400).send({ error: "not_enough_tokens" });
        }
        throw err;
      }

      if (actor.role !== "host") {
        const history = grantHistoryByActor.get(actorId) ?? [];
        history.push({ amount, at: Date.now() });
        grantHistoryByActor.set(actorId, history);
      }

      const io = getIO();
      const payload: TokenUpdatePayload = {
        guestId: targetGuest.id,
        balance: grant.balance,
        delta: grant.delta,
        reason: amount > 0 ? "grant" : "penalty",
      };
      emitToGuest(io, room.code, targetGuest.id, SOCKET_EVENTS.TOKEN_UPDATE, payload);

      const detail = `${targetGuest.nickname} ${amount > 0 ? "+" : ""}${amount} 🪙${reason ? ` — ${reason}` : ""}`;
      recordAction(io, room, {
        actor: actorId,
        action: amount > 0 ? "grant" : "penalty",
        target: targetGuest.id,
        detail,
      });

      if (amount > 0) {
        // The recipient always gets the big celebration privately, discreet
        // or not — "discreet" only means the room doesn't hear about it.
        const privateToast: ToastPayload = {
          id: crypto.randomUUID(),
          message: `+${amount} 🪙${reason ? ` — ${reason}` : ""}`,
          big: true,
          guestVisible: true,
        };
        emitToGuest(io, room.code, targetGuest.id, SOCKET_EVENTS.TOAST, privateToast);

        if (!req.body?.discreet) {
          const publicToast: ToastPayload = {
            id: crypto.randomUUID(),
            message: `🎉 ${targetGuest.nickname} earned a token${reason ? ` — ${reason}` : ""}`,
            guestVisible: true,
          };
          io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, publicToast);
        }
      } else {
        const privateToast: ToastPayload = {
          id: crypto.randomUUID(),
          message: `${amount} 🪙${reason ? ` — ${reason}` : ""}`,
          guestVisible: true,
        };
        emitToGuest(io, room.code, targetGuest.id, SOCKET_EVENTS.TOAST, privateToast);
      }

      return { ok: true, balance: grant.balance };
    },
  );
};
