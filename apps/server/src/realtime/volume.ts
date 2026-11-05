import type { Server } from "socket.io";
import { SOCKET_EVENTS, type VolumeUpdatePayload } from "@manyqueue/shared";
import { roomChannel } from "./socket-server.js";

// The last volume Spotify reported per room. It rides along in every snapshot,
// so a phone that connects later still knows it, and changes are pushed live.
const volumeByRoom = new Map<string, number | null>();

export function getRoomVolume(code: string): number | null {
  return volumeByRoom.get(code) ?? null;
}

export function updateRoomVolume(io: Server, code: string, percent: number | null): void {
  if (volumeByRoom.get(code) === percent) return;
  volumeByRoom.set(code, percent);
  const payload: VolumeUpdatePayload = { percent };
  io.to(roomChannel(code)).emit(SOCKET_EVENTS.VOLUME_UPDATE, payload);
}
