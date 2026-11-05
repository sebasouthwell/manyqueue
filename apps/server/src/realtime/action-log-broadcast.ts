import crypto from "node:crypto";
import type { Server } from "socket.io";
import { SOCKET_EVENTS, type ActionLogEntry } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import type { DBOrTx } from "../db/client.js";
import { logAction, composeActionLabel } from "../db/action-log.js";
import { emitToStaff } from "./socket-server.js";

/** Broadcasts an already-written action_log entry's resolved label to host +
 * co-host sockets — for call sites where the DB write already happened
 * elsewhere (e.g. inside a db/queue.ts function) and only the live push is
 * still needed. */
export function broadcastAction(
  io: Server,
  room: Room,
  params: { actor: string; action: string; detail?: string },
): void {
  const entry: ActionLogEntry = {
    id: crypto.randomUUID(),
    action: params.action,
    label: composeActionLabel(params.actor, params.action, params.detail, room),
    createdAt: Date.now(),
  };
  emitToStaff(io, room.code, SOCKET_EVENTS.ACTION_LOGGED, entry);
}

/** Writes the action_log row and broadcasts its resolved label to host +
 * co-host sockets in one call — the DB-write/socket-emit pairing most routes
 * that log something need. */
export function recordAction(
  io: Server,
  room: Room,
  params: { actor: string; action: string; target?: string; detail?: string },
  database?: DBOrTx,
): void {
  logAction({ roomId: room.id, ...params }, database);
  broadcastAction(io, room, params);
}
