import type { Server } from "socket.io";
import { SOCKET_EVENTS, type SceneId, type ScenePayload } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { artistsComingUp, sceneFor } from "../db/scene.js";
import { ensureGenres } from "../ai/genres.js";
import { emitToTv } from "./socket-server.js";

const lastSent = new Map<string, SceneId | null>();

/** Tells the TV which genre scene to show, if it changed. */
export function announceScene(io: Server, room: Room, force = false): void {
  const scene = sceneFor(room);
  if (!force && lastSent.has(room.id) && lastSent.get(room.id) === scene) return;
  lastSent.set(room.id, scene);
  const payload: ScenePayload = { scene };
  emitToTv(io, room.code, SOCKET_EVENTS.SCENE, payload);
}

/**
 * When a song starts: show the scene the cached tags give right away (only if it changed), then make sure the playing and coming-up
 * artists are tagged (one batched call for the ones never seen, cached for 30 days) and update the scene if
 * that changed it. Songs after the first are usually tagged before they play, so their scene is instant.
 */
export function onSongStartedScene(io: Server, room: Room): void {
  announceScene(io, room);
  void ensureGenres(room.id, artistsComingUp(room))
    .then(() => announceScene(io, room))
    .catch(() => {});
}
