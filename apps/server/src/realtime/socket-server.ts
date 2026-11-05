import type { Server, Socket } from "socket.io";
import fastifyCookie from "@fastify/cookie";
import {
  SOCKET_EVENTS,
  passiveIncomeCadence,
  type ClientRole,
  type RoomJoinPayload,
  type RoomStateSnapshot,
  type ToastPayload,
  type PingPayload,
  type VoteOpenedPayload,
  type ReactionPayload,
  type ReactionSendPayload,
  isReactionEmoji,
  reactionCooldownLeft,
} from "@manyqueue/shared";
import { getRoomByCode, type Room } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { countSongsFinished, getActiveQueueItems } from "../db/queue.js";
import { recordReaction } from "../db/reactions.js";
import { mostActiveGuest } from "../db/reaction-stats.js";
import { getSpotifyStatus } from "../spotify.js";
import { isAiConfigured } from "../ai/deepseek.js";
import { recapKey } from "../recap-access.js";
import { sceneFor } from "../db/scene.js";
import { getGuestById } from "../db/guests.js";

interface SocketData {
  code: string;
  role: ClientRole;
  guestId?: string;
}

/** Keyed by guest (not socket) so extra tabs don't buy extra reactions. */
const lastReactionAt = new Map<string, number>();

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function getSignedCookieFromSocket(socket: Socket, name: "host_session" | "guest_session"): string | null {
  const cookieHeader = socket.request.headers.cookie;
  const secret = process.env.COOKIE_SECRET;
  if (!cookieHeader || !secret) return null;

  const raw = parseCookieHeader(cookieHeader)[name];
  if (!raw) return null;

  const result = fastifyCookie.unsign(raw, secret);
  return result.valid ? result.value : null;
}

function getHostIdFromSocket(socket: Socket): string | null {
  return getSignedCookieFromSocket(socket, "host_session");
}

/** The guest this socket's signed cookie proves it is. Guest ids are public (the rotation view lists
 * them), so the id in a room:join payload means nothing on its own. */
function getGuestIdFromSocket(socket: Socket): string | null {
  return getSignedCookieFromSocket(socket, "guest_session");
}

export function roomChannel(code: string): string {
  return `room:${code}`;
}

/** Distinct guestIds with a currently-connected socket in this room. */
export function getConnectedGuestIds(io: Server, code: string): Set<string> {
  const socketIds = io.sockets.adapter.rooms.get(roomChannel(code));
  const guestIds = new Set<string>();
  if (!socketIds) return guestIds;

  for (const id of socketIds) {
    const data: SocketData | undefined = io.sockets.sockets.get(id)?.data;
    if (data?.role === "guest" && data.guestId) guestIds.add(data.guestId);
  }
  return guestIds;
}

export function getActiveGuestCount(io: Server, code: string): number {
  return getConnectedGuestIds(io, code).size;
}

/** Emits to every socket belonging to one specific guest (they may have more
 * than one tab/device open) — for private events like token balances that
 * shouldn't broadcast to the whole room. */
export function emitToGuest(
  io: Server,
  code: string,
  guestId: string,
  event: string,
  payload: unknown,
): void {
  const socketIds = io.sockets.adapter.rooms.get(roomChannel(code));
  if (!socketIds) return;

  for (const id of socketIds) {
    const socket = io.sockets.sockets.get(id);
    const data: SocketData | undefined = socket?.data;
    if (data?.role === "guest" && data.guestId === guestId) {
      socket?.emit(event, payload);
    }
  }

  // Whoever manages people (the host's People list) sees the new balance live too.
  if (event === SOCKET_EVENTS.TOKEN_UPDATE) {
    const { balance } = payload as { balance: number };
    emitToStaff(io, code, SOCKET_EVENTS.GUEST_TOKENS, { guestId, balance });
  }
}

/** Emits an event then force-disconnects every socket belonging to one guest
 * — for a kick, so it takes effect immediately instead of waiting for their
 * next reconnect attempt to be rejected. */
export function disconnectGuest(io: Server, code: string, guestId: string, event: string, payload: unknown): void {
  const socketIds = io.sockets.adapter.rooms.get(roomChannel(code));
  if (!socketIds) return;

  for (const id of socketIds) {
    const socket = io.sockets.sockets.get(id);
    const data: SocketData | undefined = socket?.data;
    if (data?.role === "guest" && data.guestId === guestId) {
      socket?.emit(event, payload);
      socket?.disconnect(true);
    }
  }
}

/** Emits only to TV sockets — moments are TV takeovers; phones never get them. */
export function emitToTv(io: Server, code: string, event: string, payload: unknown): void {
  const socketIds = io.sockets.adapter.rooms.get(roomChannel(code));
  if (!socketIds) return;
  for (const id of socketIds) {
    const socket = io.sockets.sockets.get(id);
    const data: SocketData | undefined = socket?.data;
    if (data?.role === "tv") socket?.emit(event, payload);
  }
}

/** Emits to host sockets and any guest socket whose guest row is a cohost —
 * for events that shouldn't leak to regular guests, like the action log. */
export function emitToStaff(io: Server, code: string, event: string, payload: unknown): void {
  const socketIds = io.sockets.adapter.rooms.get(roomChannel(code));
  if (!socketIds) return;

  for (const id of socketIds) {
    const socket = io.sockets.sockets.get(id);
    const data: SocketData | undefined = socket?.data;
    if (!data) continue;
    if (data.role === "host") {
      socket?.emit(event, payload);
    } else if (data.role === "guest" && data.guestId) {
      const guest = getGuestById(data.guestId);
      if (guest && (guest.role === "cohost" || (guest.perms?.length ?? 0) > 0)) socket?.emit(event, payload);
    }
  }
}

type ActiveVotesProvider = (room: Room, guestId?: string) => VoteOpenedPayload[];
let activeVotesProvider: ActiveVotesProvider | null = null;

/** Registered by the vote engine so snapshots can list open votes without
 * this file importing it (they import each other otherwise). */
export function setActiveVotesProvider(provider: ActiveVotesProvider): void {
  activeVotesProvider = provider;
}

let volumeProvider: ((code: string) => number | null) | null = null;

/** Registered by volume.ts's owner at startup so snapshots include the speaker volume. */
export function setVolumeProvider(provider: (code: string) => number | null): void {
  volumeProvider = provider;
}

let tvJoinHook: ((code: string) => void) | null = null;

/** Called whenever a TV socket joins a room (see registerMomentHooks). */
export function setTvJoinHook(hook: (code: string) => void): void {
  tvJoinHook = hook;
}

function buildSnapshot(io: Server, room: Room, guestId?: string): RoomStateSnapshot {
  const socketIds = io.sockets.adapter.rooms.get(roomChannel(room.code));
  const connected: Record<ClientRole, number> = { host: 0, tv: 0, guest: 0 };

  if (socketIds) {
    for (const id of socketIds) {
      const data: SocketData | undefined = io.sockets.sockets.get(id)?.data;
      const role: ClientRole | undefined = data?.role;
      if (role) connected[role]++;
    }
  }

  const settings = getRoomSettings(room.id);
  const spotify = getSpotifyStatus();
  const { songsUntilNextToken } = passiveIncomeCadence(
    countSongsFinished(room.id),
    settings.earnEverySongs,
  );

  return {
    code: room.code,
    name: room.name,
    status: room.status as "active" | "ended",
    connected,
    settings,
    songsUntilNextToken,
    activeVotes: activeVotesProvider?.(room, guestId) ?? [],
    volumePercent: volumeProvider?.(room.code) ?? null,
    mostActive: mostActiveGuest(room.id),
    spotifyBlockedUntil: spotify.blockedUntil,
    spotifyAuthFailed: spotify.authFailed,
    spotifyBackupNeedsLogin: spotify.backupNeedsLogin,
    aiNicknamesAvailable: isAiConfigured(),
    recapKey: room.status === "ended" ? recapKey(room) : undefined,
    scene: sceneFor(room),
    updatedAt: Date.now(),
  };
}

/** Everyone gets state:full. Guests each get their own copy while a vote is
 * open (it carries their ballot and any "Your song" restrictions); with no
 * vote open it's one shared emit. */
export function broadcastState(io: Server, room: Room) {
  const shared = buildSnapshot(io, room);
  const socketIds = io.sockets.adapter.rooms.get(roomChannel(room.code));
  if (!socketIds || !shared.activeVotes?.length) {
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.STATE_FULL, shared);
    return;
  }
  for (const id of socketIds) {
    const socket = io.sockets.sockets.get(id);
    const data: SocketData | undefined = socket?.data;
    socket?.emit(
      SOCKET_EVENTS.STATE_FULL,
      data?.role === "guest" && data.guestId ? buildSnapshot(io, room, data.guestId) : shared,
    );
  }
}

export function setupSocketServer(io: Server) {
  io.on("connection", (socket) => {
    socket.on(
      SOCKET_EVENTS.ROOM_JOIN,
      (payload: RoomJoinPayload, ack?: (ok: boolean) => void) => {
        const room = getRoomByCode(payload.code);
        if (!room) return ack?.(false);

        if (payload.role === "host" || payload.role === "tv") {
          const hostId = getHostIdFromSocket(socket);
          if (!hostId || hostId !== room.hostId) return ack?.(false);
        }

        if (payload.role === "guest" && payload.guestId) {
          // Only the guest themselves: their signed cookie has to name this exact guest, in this room.
          if (getGuestIdFromSocket(socket) !== payload.guestId) return ack?.(false);
          const guest = getGuestById(payload.guestId);
          if (!guest || guest.roomId !== room.id || guest.kickedAt) return ack?.(false);
        }

        socket.data = {
          code: payload.code,
          role: payload.role,
          guestId: payload.guestId,
        } satisfies SocketData;
        socket.join(roomChannel(payload.code));

        ack?.(true);
        broadcastState(io, room);
        if (payload.role === "tv") tvJoinHook?.(payload.code);
      },
    );

    socket.on(SOCKET_EVENTS.STATE_REQUEST, () => {
      const data = socket.data as SocketData | undefined;
      if (!data?.code) return;
      const room = getRoomByCode(data.code);
      if (!room) return;
      socket.emit(SOCKET_EVENTS.STATE_FULL, buildSnapshot(io, room, data.role === "guest" ? data.guestId : undefined));
    });

    socket.on(SOCKET_EVENTS.REACTION_SEND, (payload: ReactionSendPayload) => {
      const data = socket.data as SocketData | undefined;
      if (!data?.code || data.role !== "guest" || !data.guestId) return;
      if (!isReactionEmoji(payload?.emoji)) return;

      // Over the limit is dropped silently — the phone already dims its buttons.
      const now = Date.now();
      if (reactionCooldownLeft(lastReactionAt.get(data.guestId), now) > 0) return;

      const guest = getGuestById(data.guestId);
      const room = getRoomByCode(data.code);
      if (!guest || guest.kickedAt || !room || room.status !== "active") return;
      lastReactionAt.set(data.guestId, now);

      // TV only: phones never see each other's reactions.
      const out: ReactionPayload = { emoji: payload.emoji, guestId: data.guestId };
      emitToTv(io, data.code, SOCKET_EVENTS.REACTION, out);

      const playing = getActiveQueueItems(room.id).find((item) => item.status === "playing");
      if (playing) recordReaction(playing.id, data.guestId, payload.emoji);
    });

    socket.on(SOCKET_EVENTS.DEV_TOAST, (payload: { message: string }) => {
      const data = socket.data as SocketData | undefined;
      if (!data?.code || data.role !== "host") return;

      const toast: ToastPayload = { id: crypto.randomUUID(), message: payload.message };
      io.to(roomChannel(data.code)).emit(SOCKET_EVENTS.TOAST, toast);
    });

    socket.on(SOCKET_EVENTS.PING, (payload: PingPayload) => {
      socket.emit(SOCKET_EVENTS.PONG, { clientTime: payload.clientTime, serverTime: Date.now() });
    });

    socket.on("disconnect", () => {
      const data = socket.data as SocketData | undefined;
      if (!data?.code) return;
      const room = getRoomByCode(data.code);
      if (room) broadcastState(io, room);
    });
  });
}
