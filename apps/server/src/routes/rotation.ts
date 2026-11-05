import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { songRuleViolation, checkDedication, SOCKET_EVENTS, type TokenUpdatePayload } from "@manyqueue/shared";
import { getRoomByCode, type Room } from "../db/rooms.js";
import { getActiveGuest, requirePerm, type Actor } from "../auth-helpers.js";
import { getRoomSettings } from "../db/settings.js";
import { getTrackInfo } from "../spotify.js";
import { addQueueItem } from "../db/queue.js";
import {
  getMineQueue,
  setMineDedication,
  sendToMysteryPool,
  pullFromMysteryPool,
  removeRotationItem,
  hostDraftItem,
  draftRandomGuest,
  skipGuestTurn,
  setGuestWeight,
  nextMinePosition,
  type HostDraftResult,
} from "../db/rotation.js";
import { getGuestById } from "../db/guests.js";
import { balance } from "../db/tokens.js";
import { db } from "../db/client.js";
import { queueItems } from "../db/schema.js";
import { getIO } from "../realtime/io-instance.js";
import { emitToGuest } from "../realtime/socket-server.js";
import { recordAction } from "../realtime/action-log-broadcast.js";
import { broadcastRotationState, broadcastBallotState, buildRotationRoomView, buildMineView, buildHostRotationBoard } from "../realtime/rotation-views.js";
import { castVote, getMyVote, pullFromBallot } from "../realtime/crowd-pick.js";
import { POOL_KEY, skipPendingDraft, vetoCommitsAt } from "../realtime/draft-veto.js";
import { forecastUpcoming } from "../realtime/rotation-loop.js";

interface AddBody {
  trackUri?: string;
  name?: string;
  artistName?: string;
  albumArtUrl?: string | null;
  durationMs?: number;
  explicit?: boolean;
}

interface OrderBody {
  itemIds?: string[];
}

/** For the action log: host/cohost read as their role, a plain guest acting on the approve permission
 * reads as their nickname instead of a bare "guest" — same as how the log already names other staff
 * actions taken through a granted permission rather than a role. */
function actorLabelFor(actor: Actor): string {
  if (actor.role === "host") return "host";
  if (actor.role === "cohost") return "cohost";
  const guest = actor.guestId ? getGuestById(actor.guestId) : undefined;
  return guest?.nickname ?? "guest";
}

export const rotationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string } }>("/rooms/:code/mine", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    return { mine: buildMineView(room.id, guest.id) };
  });

  app.get<{ Params: { code: string } }>("/rooms/:code/rotation", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    return { rotation: buildRotationRoomView(room) };
  });

  app.get<{ Params: { code: string } }>("/rooms/:code/rotation/host", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    // Same bar as the drafting actions below: Rotation mode's "commit a song to play" is drafting,
    // same as Shared mode's is approving — approve is drafting power here, not a separate concept.
    if (!requirePerm(req, room, "approve")) return reply.code(403).send({ error: "forbidden" });
    return { board: buildHostRotationBoard(room) };
  });

  app.post<{ Params: { code: string }; Body: AddBody }>("/rooms/:code/mine", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });

    const settings = getRoomSettings(room.id);
    if (settings.mode !== "rotation") return reply.code(400).send({ error: "not_rotation_mode" });

    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    if (guest.muted) return reply.code(403).send({ error: "muted" });

    const { trackUri, name, artistName, albumArtUrl, durationMs, explicit } = req.body ?? {};
    if (!trackUri || !name || !artistName || typeof durationMs !== "number") {
      return reply.code(400).send({ error: "invalid_track" });
    }

    const mine = getMineQueue(room.id, guest.id);
    if (mine.length >= settings.personalQueueCap) {
      return reply.code(400).send({ error: "queue_full", cap: settings.personalQueueCap });
    }

    if (settings.maxSongMin !== null || !settings.explicit) {
      const info = await getTrackInfo(room.hostId, trackUri).catch(() => null);
      const violation = songRuleViolation(info ?? { durationMs, explicit: !!explicit }, settings);
      if (violation) return reply.code(400).send({ error: "rule_violation", rule: violation });
    }

    const item = addQueueItem(
      { roomId: room.id, trackUri, trackName: name, artistName, albumArtUrl: albumArtUrl ?? null, durationMs, addedBy: guest.id },
      db,
    );
    db.update(queueItems).set({ status: "mine", minePosition: nextMinePosition(mine) }).where(eq(queueItems.id, item.id)).run();

    broadcastRotationState(getIO(), room);
    return { ok: true, itemId: item.id };
  });

  app.patch<{ Params: { code: string }; Body: OrderBody }>("/rooms/:code/mine/order", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });

    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });

    const { itemIds } = req.body ?? {};
    if (!Array.isArray(itemIds)) return reply.code(400).send({ error: "invalid_order" });

    const mine = getMineQueue(room.id, guest.id);
    const currentIds = new Set(mine.map((m) => m.id));
    const sameSet = itemIds.length === mine.length && itemIds.every((id) => currentIds.has(id));
    if (!sameSet) return reply.code(400).send({ error: "invalid_order" });

    itemIds.forEach((id, index) => {
      db.update(queueItems)
        .set({ minePosition: index })
        .where(and(eq(queueItems.id, id), eq(queueItems.addedBy, guest.id), eq(queueItems.status, "mine")))
        .run();
    });

    broadcastRotationState(getIO(), room);
    return { ok: true };
  });

  app.patch<{ Params: { code: string; id: string }; Body: { dedication?: string | null; toPool?: boolean; fromPool?: boolean } }>(
    "/rooms/:code/items/:id",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });

      const { dedication, toPool, fromPool } = req.body ?? {};

      if (toPool) {
        const result = sendToMysteryPool(req.params.id, guest.id);
        if (result === "not_found") return reply.code(404).send({ error: "not_found" });
        if (result === "already_in_pool") return reply.code(400).send({ error: "already_in_pool" });
        broadcastRotationState(getIO(), room);
        return { ok: true };
      }

      if (fromPool) {
        const item = pullFromMysteryPool(req.params.id, guest.id);
        if (!item) return reply.code(404).send({ error: "not_found" });
        broadcastRotationState(getIO(), room);
        return { ok: true };
      }

      if (dedication !== undefined) {
        let text: string | null = null;
        if (dedication !== null && dedication !== "") {
          const checked = checkDedication(dedication);
          if (!checked.ok) return reply.code(400).send({ error: "dedication_rejected", reason: checked.error });
          text = checked.text; // checked.ok narrows DedicationCheck here, so .text is available
        }
        const result = setMineDedication(req.params.id, guest.id, text);
        if (!result) return reply.code(404).send({ error: "not_found" });
        if (result.charged > 0) {
          const payload: TokenUpdatePayload = {
            guestId: guest.id,
            balance: balance(guest.id),
            delta: -result.charged,
            reason: "dedication",
          };
          emitToGuest(getIO(), room.code, guest.id, SOCKET_EVENTS.TOKEN_UPDATE, payload);
        }
        broadcastRotationState(getIO(), room);
        return { ok: true };
      }

      return reply.code(400).send({ error: "nothing_to_do" });
    },
  );

  app.delete<{ Params: { code: string; id: string } }>("/rooms/:code/mine/:id", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });

    const settings = getRoomSettings(room.id);
    const result = removeRotationItem(req.params.id, guest.id, settings.tokenCap);
    if (!result) return reply.code(404).send({ error: "not_found" });

    if (result.balanceAfterRefund !== null) {
      const payload: TokenUpdatePayload = {
        guestId: guest.id,
        balance: result.balanceAfterRefund,
        delta: result.item.paid,
        reason: "refund_reject",
      };
      emitToGuest(getIO(), room.code, guest.id, SOCKET_EVENTS.TOKEN_UPDATE, payload);
    }
    broadcastRotationState(getIO(), room);
    return { ok: true };
  });

  function announceHostDraft(room: Room, actorLabel: string, result: HostDraftResult) {
    const guestId = result.item.addedBy!;
    if (result.chargedTokens > 0 || result.onHouse) {
      const payload: TokenUpdatePayload = {
        guestId,
        balance: balance(guestId),
        delta: -result.chargedTokens,
        reason: "queue_add",
      };
      emitToGuest(getIO(), room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
    }
    if (result.displaced?.addedBy) {
      const payload: TokenUpdatePayload = {
        guestId: result.displaced.addedBy,
        balance: balance(result.displaced.addedBy),
        delta: result.displaced.paid,
        reason: "refund_reject",
      };
      emitToGuest(getIO(), room.code, result.displaced.addedBy, SOCKET_EVENTS.TOKEN_UPDATE, payload);
    }
    const guest = getGuestById(guestId);
    recordAction(
      getIO(),
      room,
      {
        actor: actorLabel,
        action: "rotation_draft",
        detail: `"${result.item.trackName}"${guest ? ` (${guest.nickname})` : ""}${result.onHouse ? " · on the house" : ""}`,
      },
      db,
    );
    broadcastRotationState(getIO(), room);
  }

  app.post<{ Params: { code: string }; Body: { itemId?: string; random?: boolean; onHouse?: boolean } }>(
    "/rooms/:code/draft",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      // Same bar as everywhere approve applies in Shared mode: host and co-hosts always, plus anyone
      // the host granted the approve permission to — drafting is what "approve" means here.
      const actor = requirePerm(req, room, "approve");
      if (!actor) return reply.code(403).send({ error: "forbidden" });

      const settings = getRoomSettings(room.id);
      const onHouse = req.body?.onHouse ?? settings.hostDraftPays === "house";
      const actorLabel = actorLabelFor(actor);

      const result = req.body?.random
        ? draftRandomGuest(room.id, onHouse)
        : req.body?.itemId
          ? hostDraftItem(room.id, req.body.itemId, onHouse)
          : null;

      if (!result) return reply.code(400).send({ error: "cant_draft" });
      announceHostDraft(room, actorLabel, result);
      return { ok: true };
    },
  );

  // ---- Auto + veto (§9) ----

  // Skip the song rotation is about to draft: that guest (or the mystery pool) sits this slot out and
  // keeps their turn. `itemId` is the pending song the host saw (null for a mystery slot), so a stale tap
  // after the forecast moved on never skips somebody else.
  app.post<{ Params: { code: string }; Body: { itemId?: unknown } }>("/rooms/:code/draft/skip", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const actor = requirePerm(req, room, "approve");
    if (!actor) return reply.code(403).send({ error: "forbidden" });
    if (vetoCommitsAt(room.id) === null) return reply.code(409).send({ error: "no_pending_draft" });
    const pending = forecastUpcoming(room)[0];
    const seen = req.body?.itemId ?? null;
    if (!pending || pending.kind === "house") return reply.code(400).send({ error: "nothing_to_skip" });
    if ((pending.itemId ?? null) !== seen) return reply.code(409).send({ error: "stale" });
    const key = pending.kind === "mystery" ? POOL_KEY : pending.ownerId!;
    if (!skipPendingDraft(room.id, key)) return reply.code(409).send({ error: "no_pending_draft" });
    const who = pending.kind === "mystery" ? "the mystery pick" : (getGuestById(key)?.nickname ?? "a guest");
    recordAction(getIO(), room, { actor: actorLabelFor(actor), action: "draft_skip", detail: `${who} for this slot (they keep their turn)` });
    broadcastBallotState(getIO(), room);
    return { ok: true };
  });

  // ---- Crowd pick (§6, §15) ----

  app.get<{ Params: { code: string } }>("/rooms/:code/ballot/vote", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    return { vote: getMyVote(room.id, guest.id) };
  });

  app.post<{ Params: { code: string }; Body: { itemId?: unknown } }>("/rooms/:code/ballot/vote", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    const itemId = req.body?.itemId;
    if (typeof itemId !== "string") return reply.code(400).send({ error: "invalid_item" });
    // One person, one vote, changeable until it closes; voting for your own song counts too (D8).
    const result = castVote(room, guest.id, itemId);
    if (result !== "ok") return reply.code(400).send({ error: result });
    broadcastBallotState(getIO(), room);
    return { ok: true };
  });

  app.post<{ Params: { code: string }; Body: { itemId?: unknown } }>("/rooms/:code/ballot/pull", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    // Pulling a candidate is drafting power, the same bar as Draft now.
    const actor = requirePerm(req, room, "approve");
    if (!actor) return reply.code(403).send({ error: "forbidden" });
    const itemId = req.body?.itemId;
    if (typeof itemId !== "string") return reply.code(400).send({ error: "invalid_item" });
    if (!pullFromBallot(room, itemId)) return reply.code(400).send({ error: "not_on_ballot" });
    recordAction(getIO(), room, { actor: actorLabelFor(actor), action: "ballot_pull", detail: "a song from the Crowd pick ballot" });
    broadcastBallotState(getIO(), room);
    return { ok: true };
  });

  app.post<{ Params: { code: string }; Body: { skip?: string; weight?: { guestId: string; value: number } } }>(
    "/rooms/:code/rotation",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "approve");
      if (!actor) return reply.code(403).send({ error: "forbidden" });

      const { skip, weight } = req.body ?? {};

      if (weight) {
        // Host only (§8) — a co-host setting another guest's turn frequency is a bigger lever than
        // anything else they can do, and unlike a draft/skip it has no undo.
        if (actor.role !== "host") return reply.code(403).send({ error: "forbidden" });
        const ok = setGuestWeight(room.id, weight.guestId, weight.value);
        if (!ok) return reply.code(400).send({ error: "invalid_weight" });
        const guest = getGuestById(weight.guestId);
        recordAction(getIO(), room, { actor: "host", action: "rotation_weight", detail: `${guest?.nickname ?? ""} ×${weight.value}` }, db);
        broadcastRotationState(getIO(), room);
        return { ok: true };
      }

      if (!skip) return reply.code(400).send({ error: "nothing_to_do" });

      const ok = skipGuestTurn(room.id, skip);
      if (!ok) return reply.code(404).send({ error: "not_found" });

      const guest = getGuestById(skip);
      recordAction(
        getIO(),
        room,
        { actor: actorLabelFor(actor), action: "rotation_skip", detail: guest?.nickname },
        db,
      );
      broadcastRotationState(getIO(), room);
      return { ok: true };
    },
  );
};
