import type { FastifyPluginAsync } from "fastify";
import { SOCKET_EVENTS, RoomSettingsPatchSchema } from "@manyqueue/shared";
import { getAuthenticatedHost } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import { getRoomSettings, updateRoomSettings } from "../db/settings.js";
import { switchRoomMode } from "../db/rotation.js";
import { getIO } from "../realtime/io-instance.js";
import { roomChannel, broadcastState } from "../realtime/socket-server.js";
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
      const settings = updateRoomSettings(room.id, parsed.data);
      if (parsed.data.tvScenes !== undefined) announceScene(getIO(), room, true); // the TV switches at once

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
