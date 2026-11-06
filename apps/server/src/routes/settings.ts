import type { FastifyPluginAsync } from "fastify";
import { SOCKET_EVENTS, RoomSettingsPatchSchema, type TokenUpdatePayload } from "@manyqueue/shared";
import { getAuthenticatedHost } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import { getRoomSettings, updateRoomSettings } from "../db/settings.js";
import { switchRoomMode } from "../db/rotation.js";
import { getIO } from "../realtime/io-instance.js";
import { roomChannel, broadcastState, emitToGuest } from "../realtime/socket-server.js";
import { clearFights } from "../db/fight.js";
import { broadcastContestPool, getRunningContest } from "../realtime/contest.js";
import { broadcastRotationState } from "../realtime/rotation-views.js";
import { announceScene } from "../realtime/scenes.js";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string } }>("/rooms/:code/settings", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });

    const room = getRoomByCode(req.params.code);
    if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

    return { settings: getRoomSettings(room.id) };
  });

  app.patch<{ Params: { code: string }; Body: unknown }>(
    "/rooms/:code/settings",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });

      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      const parsed = RoomSettingsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_settings", details: parsed.error.flatten() });
      }

      const before = getRoomSettings(room.id);
      // Rotation mode runs without tokens by default: everyone simply takes turns. The host can turn
      // them back on afterwards (or in the same change, which wins).
      const enteringRotation = parsed.data.mode === "rotation" && before.mode !== "rotation";
      const settings = updateRoomSettings(
        room.id,
        enteringRotation && parsed.data.tokenMode === undefined ? { ...parsed.data, tokenMode: false } : parsed.data,
      );
      if (parsed.data.tvScenes !== undefined) announceScene(getIO(), room, true); // the TV switches at once

      // Fights closed (turned off, or Crowd pick on): waiting entries go back to their owners' queues,
      // refunded. One mid-vote finishes.
      const fightsWereOpen = before.mode === "rotation" && before.nextSongMethod === "rotation" && before.fights;
      if (fightsWereOpen && settings.mode === "rotation" && !(settings.nextSongMethod === "rotation" && settings.fights)) {
        const running = getRunningContest(room.id);
        const busy = running ? ((running.meta as { entries?: { entryId: string }[] }).entries ?? []).map((e) => e.entryId) : [];
        for (const left of clearFights(room.id, busy)) {
          if (left.balance !== null) {
            const payload: TokenUpdatePayload = { guestId: left.entry.enteredBy, balance: left.balance, delta: left.refunded, reason: "refund_expire" };
            emitToGuest(getIO(), room.code, left.entry.enteredBy, SOCKET_EVENTS.TOKEN_UPDATE, payload);
          }
        }
        broadcastRotationState(getIO(), room);
        broadcastContestPool(getIO(), room);
      }

      if (parsed.data.mode !== undefined && parsed.data.mode !== before.mode) {
        switchRoomMode(room.id, parsed.data.mode);
        broadcastState(getIO(), room); // queue/token changes from the migration need a full resync
      }

      getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.SETTINGS_UPDATE, settings);
      getIO()
        .to(roomChannel(room.code))
        .emit(SOCKET_EVENTS.TOAST, { id: crypto.randomUUID(), message: "Updated for everyone" });

      return { settings };
    },
  );
};
