import type { FastifyPluginAsync } from "fastify";
import { SOCKET_EVENTS, cleanPartyName, type RoomEndedPayload, type RoomExportPayload, type TokenUpdatePayload } from "@manyqueue/shared";
import { getAuthenticatedHost } from "../auth-helpers.js";
import {
  getOrCreateActiveRoomForHost,
  getActiveRoomForHost,
  getRoomByCode,
  setRoomDevice,
  setRoomName,
  setRoomExport,
  setFallbackPlaylist,
  endRoom,
  type Room,
} from "../db/rooms.js";
import { getPlayedItemsInOrder, getActiveQueueItems, refundQueueItem } from "../db/queue.js";
import { listPoolEntries, removePoolEntry } from "../db/contest.js";
import { getRoomSettings, updateRoomSettings } from "../db/settings.js";
import { SpotifyAuthError, SpotifyQuotaError, listDevices, transferPlayback, createPlaylist, addTracksToPlaylist } from "../spotify.js";
import { startPlayerLoop, stopPlayerLoop } from "../realtime/player-loop.js";
import { runNightEndBatch } from "../realtime/ai-nicknames.js";
import { evaluateLabels } from "../realtime/labels.js";
import { recapKey } from "../recap-access.js";
import { getIO } from "../realtime/io-instance.js";
import { roomChannel, emitToGuest, broadcastState } from "../realtime/socket-server.js";
import { parsePlaylistId, primeFallbackPlaylist } from "../fallback-playlist.js";

function joinUrl(code: string): string {
  const base = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(
    /\/$/,
    "",
  );
  return `${base}/r/${code}`;
}

function serializeRoom(room: Room) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    status: room.status,
    joinUrl: joinUrl(room.code),
    deviceId: room.deviceId,
    deviceName: room.deviceName,
    fallbackPlaylistUri: room.fallbackPlaylistUri,
  };
}

async function exportNightPlaylist(room: Room, hostId: string, uris: string[]): Promise<void> {
  const io = getIO();
  try {
    const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const playlist = await createPlaylist(hostId, `ManyQueue — ${room.name} · ${dateStr}`);
    await addTracksToPlaylist(hostId, playlist.id, uris);
    setRoomExport(room.id, playlist.id);
    const done: RoomExportPayload = { playlistUrl: playlist.url };
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.ROOM_EXPORT, done);
  } catch (err) {
    console.error(`[end-night:${room.code}] playlist export failed:`, err);
    const failed: RoomExportPayload = { playlistUrl: null };
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.ROOM_EXPORT, failed);
  }
}

export const roomRoutes: FastifyPluginAsync = async (app) => {
  // Starting a night: the host picks how the queue works first (Shared or Rotation). An already-active
  // room is returned untouched; the mode only applies to a room created by this call.
  app.post<{ Body: { mode?: "shared" | "rotation" } }>("/rooms", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });

    const existed = !!getActiveRoomForHost(host.id);
    const room = getOrCreateActiveRoomForHost(host);
    const mode = req.body?.mode;
    if (!existed && (mode === "shared" || mode === "rotation")) {
      // Rotation runs without tokens by default (everyone simply takes turns), same as switching to it.
      updateRoomSettings(room.id, mode === "rotation" ? { mode, tokenMode: false } : { mode });
    }
    return { room: serializeRoom(room) };
  });

  app.get("/rooms/current", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });

    const room = getActiveRoomForHost(host.id);
    if (!room) return reply.code(404).send({ error: "no_active_room" });

    return { room: serializeRoom(room) };
  });

  // Public: lets the guest join screen show the room name before authenticating.
  app.get<{ Params: { code: string } }>("/rooms/:code", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room || room.status !== "active") {
      return reply.code(404).send({ error: "room_not_found" });
    }
    return { room: { code: room.code, name: room.name, status: room.status } };
  });

  // The host names the party. state:full carries the name, so the TV and every
  // phone pick the change up straight away.
  app.patch<{ Params: { code: string }; Body: { name?: string } }>("/rooms/:code/name", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });
    const room = getRoomByCode(req.params.code);
    if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });
    if (room.status !== "active") return reply.code(400).send({ error: "room_ended" });

    const checked = cleanPartyName(req.body?.name);
    if (!checked.ok) return reply.code(400).send({ error: "invalid_name", reason: checked.error });

    setRoomName(room.id, checked.name);
    const updated = getRoomByCode(room.code);
    if (updated) broadcastState(getIO(), updated);
    return { name: checked.name };
  });

  app.get<{ Params: { code: string } }>("/rooms/:code/devices", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });

    const room = getRoomByCode(req.params.code);
    if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

    try {
      const devices = await listDevices(host.id);
      return { devices, activeDeviceId: room.deviceId };
    } catch (err) {
      if (err instanceof SpotifyQuotaError) {
        return reply.code(503).send({ error: "spotify_rate_limited", retryAfterSec: err.retryAfterSec });
      }
      if (err instanceof SpotifyAuthError) return reply.code(401).send({ error: "spotify_auth" });
      req.log.error(err, "failed to list Spotify devices");
      return reply.code(502).send({ error: "devices_failed" });
    }
  });

  app.post<{ Params: { code: string }; Body: { deviceId?: string; deviceName?: string } }>(
    "/rooms/:code/device",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });

      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      const { deviceId, deviceName } = req.body ?? {};
      if (!deviceId || !deviceName) return reply.code(400).send({ error: "invalid_device" });

      setRoomDevice(room.id, deviceId, deviceName);
      try {
        await transferPlayback(host.id, deviceId, false);
      } catch (err) {
        req.log.error(err, "failed to transfer playback");
      }
      startPlayerLoop(room.code, deviceId, deviceName);

      return { ok: true };
    },
  );

  app.post<{ Params: { code: string }; Body: { playlistUrl?: string } }>(
    "/rooms/:code/fallback-playlist",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });

      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      const playlistId = parsePlaylistId(req.body?.playlistUrl ?? "");
      if (!playlistId) return reply.code(400).send({ error: "invalid_playlist_url" });

      try {
        const trackCount = await primeFallbackPlaylist(host.id, playlistId);
        if (trackCount === 0) return reply.code(400).send({ error: "empty_playlist" });

        setFallbackPlaylist(room.id, `spotify:playlist:${playlistId}`);
        return { ok: true, trackCount };
      } catch (err) {
        req.log.error(err, "failed to load fallback playlist");
        return reply.code(502).send({ error: "playlist_load_failed" });
      }
    },
  );

  app.post<{ Params: { code: string } }>("/rooms/:code/end", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });

    const room = getRoomByCode(req.params.code);
    if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });
    if (room.status !== "active") return reply.code(400).send({ error: "already_ended" });

    const played = getPlayedItemsInOrder(room.id);
    const uris = played.map((item) => item.trackUri);

    const settings = getRoomSettings(room.id);
    const stillQueued = getActiveQueueItems(room.id).filter(
      (item) =>
        (item.status === "queued" || item.status === "locked" || item.status === "pending") &&
        item.paid > 0,
    );
    for (const item of stillQueued) {
      const newBalance = refundQueueItem(item, "refund_expire", settings.tokenCap);
      if (newBalance !== null && item.addedBy) {
        const payload: TokenUpdatePayload = {
          guestId: item.addedBy,
          balance: newBalance,
          delta: item.paid,
          reason: "refund_expire",
        };
        emitToGuest(getIO(), room.code, item.addedBy, SOCKET_EVENTS.TOKEN_UPDATE, payload);
      }
    }

    // Songs still waiting in the contest pool get their entry token back too.
    for (const entry of listPoolEntries(room.id)) {
      const removed = removePoolEntry(entry.id, "refund_expire", settings.tokenCap);
      if (removed?.balance != null) {
        const payload: TokenUpdatePayload = {
          guestId: entry.enteredBy,
          balance: removed.balance,
          delta: removed.item.paid,
          reason: "refund_expire",
        };
        emitToGuest(getIO(), room.code, entry.enteredBy, SOCKET_EVENTS.TOKEN_UPDATE, payload);
      }
    }

    endRoom(room.id, null);
    stopPlayerLoop(room.code);

    // The night ends right now. Building the Spotify playlist (a create call, then the
    // tracks in batches) is what used to make ending slow, so it happens afterwards
    // and its link is pushed when it's ready.
    const exportPending = uris.length > 0;
    const payload: RoomEndedPayload = { songCount: uris.length, playlistUrl: null, exportPending, recapKey: recapKey(room) };
    getIO().to(roomChannel(room.code)).emit(SOCKET_EVENTS.ROOM_ENDED, payload);
    evaluateLabels(getIO(), room); // last chance to earn one before the recap
    runNightEndBatch(getIO(), room); // nicknames for the recap; runs after the night has already ended

    if (exportPending) {
      void exportNightPlaylist(room, host.id, uris).catch((err) => req.log.error(err, "end-of-night export crashed"));
    }

    return { ok: true, songCount: uris.length, playlistUrl: null, exportPending, recapKey: recapKey(room) };
  });
};
