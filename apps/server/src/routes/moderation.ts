import type { FastifyPluginAsync } from "fastify";
import {
  SOCKET_EVENTS,
  type ToastPayload,
  type TokenUpdatePayload,
  type GuestRemovedPayload,
  type IdentityChangedPayload,
  type MutedChangedPayload,
  type AnnounceAllowedChangedPayload,
} from "@manyqueue/shared";
import { requirePerm } from "../auth-helpers.js";
import { getPoolEntryForGuest, removePoolEntry } from "../db/contest.js";
import { broadcastContestPool, getRunningContest } from "../realtime/contest.js";
import { getRoomByCode } from "../db/rooms.js";
import { getGuestById, setGuestMuted, setGuestCanAnnounce, setGuestKicked, updateGuestIdentity } from "../db/guests.js";
import { getActiveQueueItems, refundQueueItem, removeQueuedItem, serializeQueue } from "../db/queue.js";
import { getRoomSettings } from "../db/settings.js";
import { blockDevice } from "../db/blocked-devices.js";
import { getIO } from "../realtime/io-instance.js";
import { roomChannel, emitToGuest, disconnectGuest } from "../realtime/socket-server.js";
import { recordAction } from "../realtime/action-log-broadcast.js";
import { maybeApplyFairOrder, maybeRecomputeApprovalLockAt } from "../realtime/queue-recompute.js";

/** A co-host can moderate a regular guest, but never the host or another
 * co-host — same boundary Block 22 drew for kick specifically; applied
 * uniformly here to mute and reset-nickname too. */
function targetIsProtectedFromCohost(actorRole: string, target: { role: string }, actorGuestId?: string, targetId?: string): boolean {
  if (actorGuestId && actorGuestId === targetId) return true;
  return actorRole !== "host" && target.role === "cohost";
}

export const moderationRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { code: string; guestId: string } }>(
    "/rooms/:code/guests/:guestId/kick",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "moderation");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      const target = getGuestById(req.params.guestId);
      if (!target || target.roomId !== room.id) return reply.code(404).send({ error: "guest_not_found" });
      if (targetIsProtectedFromCohost(actor.role, target, actor.guestId, target.id)) {
        return reply.code(403).send({ error: "cannot_moderate" });
      }

      const io = getIO();
      const settings = getRoomSettings(room.id);

      // Refund and pull anything of theirs still waiting to play — being
      // kicked isn't their song's fault, but it shouldn't keep playing either.
      // (A locked track is already handed to Spotify, so it's left alone.)
      const theirWaitingItems = getActiveQueueItems(room.id).filter(
        (item) => item.addedBy === target.id && (item.status === "queued" || item.status === "pending"),
      );
      for (const item of theirWaitingItems) {
        const newBalance = refundQueueItem(item, "refund_reject", settings.tokenCap);
        if (newBalance !== null) {
          const payload: TokenUpdatePayload = {
            guestId: target.id,
            balance: newBalance,
            delta: item.paid,
            reason: "refund_reject",
          };
          emitToGuest(io, room.code, target.id, SOCKET_EVENTS.TOKEN_UPDATE, payload);
        }
        removeQueuedItem(item.id);
      }

      // A song of theirs waiting in the contest pool goes too (its token back),
      // unless it's mid-vote; the contest cancels itself cleanly when it ends.
      const poolEntry = getPoolEntryForGuest(room.id, target.id);
      if (poolEntry && !JSON.stringify(getRunningContest(room.id)?.meta ?? "").includes(poolEntry.id)) {
        const removed = removePoolEntry(poolEntry.id, "refund_reject", settings.tokenCap);
        if (removed?.balance != null) {
          const payload: TokenUpdatePayload = {
            guestId: target.id,
            balance: removed.balance,
            delta: removed.item.paid,
            reason: "refund_reject",
          };
          emitToGuest(io, room.code, target.id, SOCKET_EVENTS.TOKEN_UPDATE, payload);
        }
        broadcastContestPool(io, room);
      }

      // Archived, not deleted: the row stays (kickedAt set) so the night's
      // history is intact, but they drop out of the live session.
      setGuestKicked(target.id);
      // Best-effort, not real device fingerprinting: block what the TARGET was last seen on — their
      // device cookie (survives them clearing guest_session) and their last IP — not req.ip here, which
      // is the moderator's own address, not the person being kicked.
      if (target.deviceId) blockDevice(room.id, target.deviceId);
      if (target.lastIp) blockDevice(room.id, target.lastIp);

      const actorId = actor.hostId ?? actor.guestId!;
      recordAction(io, room, {
        actor: actorId,
        action: "kick",
        target: target.id,
        detail: target.nickname,
      });

      const kickedPayload: GuestRemovedPayload = { reason: "kicked" };
      disconnectGuest(io, room.code, target.id, SOCKET_EVENTS.GUEST_KICKED, kickedPayload);

      maybeApplyFairOrder(room);
      maybeRecomputeApprovalLockAt(room);
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));

      return { ok: true };
    },
  );

  app.post<{ Params: { code: string; guestId: string }; Body: { muted?: boolean } }>(
    "/rooms/:code/guests/:guestId/mute",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "moderation");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      const target = getGuestById(req.params.guestId);
      if (!target || target.roomId !== room.id) return reply.code(404).send({ error: "guest_not_found" });
      if (targetIsProtectedFromCohost(actor.role, target, actor.guestId, target.id)) {
        return reply.code(403).send({ error: "cannot_moderate" });
      }

      const muted = req.body?.muted !== false;
      setGuestMuted(target.id, muted);

      const io = getIO();
      const actorId = actor.hostId ?? actor.guestId!;
      recordAction(io, room, {
        actor: actorId,
        action: muted ? "mute" : "unmute",
        target: target.id,
        detail: target.nickname,
      });

      const toast: ToastPayload = {
        id: crypto.randomUUID(),
        message: muted
          ? "You've been muted — you can still vote and react, just not add songs."
          : "You've been unmuted.",
        guestVisible: true,
      };
      emitToGuest(io, room.code, target.id, SOCKET_EVENTS.TOAST, toast);
      const mutedPayload: MutedChangedPayload = { muted };
      emitToGuest(io, room.code, target.id, SOCKET_EVENTS.MUTED_CHANGED, mutedPayload);

      return { ok: true, muted };
    },
  );

  // Announcements are on for every guest by default (a fun little feature); staff can take it away
  // from one guest specifically without muting them from everything else.
  app.post<{ Params: { code: string; guestId: string }; Body: { canAnnounce?: boolean } }>(
    "/rooms/:code/guests/:guestId/announce",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "moderation");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      const target = getGuestById(req.params.guestId);
      if (!target || target.roomId !== room.id) return reply.code(404).send({ error: "guest_not_found" });
      if (targetIsProtectedFromCohost(actor.role, target, actor.guestId, target.id)) {
        return reply.code(403).send({ error: "cannot_moderate" });
      }

      const canAnnounce = req.body?.canAnnounce !== false;
      setGuestCanAnnounce(target.id, canAnnounce);

      const io = getIO();
      const actorId = actor.hostId ?? actor.guestId!;
      recordAction(io, room, {
        actor: actorId,
        action: canAnnounce ? "announce_allow" : "announce_block",
        target: target.id,
        detail: target.nickname,
      });

      const toast: ToastPayload = {
        id: crypto.randomUUID(),
        message: canAnnounce ? "You can announce to the room again." : "Announcements have been turned off for you.",
        guestVisible: true,
      };
      emitToGuest(io, room.code, target.id, SOCKET_EVENTS.TOAST, toast);
      const payload: AnnounceAllowedChangedPayload = { canAnnounce };
      emitToGuest(io, room.code, target.id, SOCKET_EVENTS.ANNOUNCE_ALLOWED_CHANGED, payload);

      return { ok: true, canAnnounce };
    },
  );

  app.post<{ Params: { code: string; guestId: string }; Body: { nickname?: string } }>(
    "/rooms/:code/guests/:guestId/rename",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "moderation");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });

      const target = getGuestById(req.params.guestId);
      if (!target || target.roomId !== room.id || target.kickedAt) {
        return reply.code(404).send({ error: "guest_not_found" });
      }
      if (targetIsProtectedFromCohost(actor.role, target, actor.guestId, target.id)) {
        return reply.code(403).send({ error: "cannot_moderate" });
      }

      const nickname = (typeof req.body?.nickname === "string" ? req.body.nickname : "").trim().slice(0, 20);
      if (nickname.length < 1) return reply.code(400).send({ error: "invalid_nickname" });

      // Staff renames skip the guest's own 10-minute change cooldown.
      const updated = updateGuestIdentity(target, nickname, target.emoji);

      const io = getIO();
      const actorId = actor.hostId ?? actor.guestId!;
      recordAction(io, room, {
        actor: actorId,
        action: "rename",
        target: target.id,
        detail: `${target.nickname} to ${updated.nickname}`,
      });

      const changed: IdentityChangedPayload = { nickname: updated.nickname, emoji: updated.emoji };
      emitToGuest(io, room.code, target.id, SOCKET_EVENTS.IDENTITY_CHANGED, changed);
      const toast: ToastPayload = {
        id: crypto.randomUUID(),
        message: `The host renamed you to ${updated.nickname}.`,
        guestVisible: true,
      };
      emitToGuest(io, room.code, target.id, SOCKET_EVENTS.TOAST, toast);
      io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.QUEUE_UPDATE, serializeQueue(room.id));

      return { ok: true, nickname: updated.nickname };
    },
  );
};
