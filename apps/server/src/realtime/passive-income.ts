import crypto from "node:crypto";
import type { Server } from "socket.io";
import {
  SOCKET_EVENTS,
  passiveIncomeCadence,
  type ToastPayload,
  type TokenUpdatePayload,
} from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { countSongsFinished } from "../db/queue.js";
import { apply, TokenCapExceededError } from "../db/tokens.js";
import { getConnectedGuestIds, roomChannel, emitToGuest, broadcastState } from "./socket-server.js";

/**
 * Called after any song is finished (played or skipped) — pays +1 `passive`
 * to every guest with a currently-connected socket, once every
 * `earnEverySongs` finished songs. Guests already at the cap get nothing and
 * nothing is saved up for them (TokenCapExceededError is expected, not a bug).
 *
 * Also re-broadcasts state:full every time, whether or not this call actually
 * pays out, since songsUntilNextToken ticks down on every finished song.
 */
export function maybePayPassiveIncome(io: Server, room: Room): void {
  const settings = getRoomSettings(room.id);
  if (!settings.tokenMode) return;

  broadcastState(io, room);

  const finished = countSongsFinished(room.id);
  const { isPayoutTick } = passiveIncomeCadence(finished, settings.earnEverySongs);
  if (!isPayoutTick) return;

  const guestIds = getConnectedGuestIds(io, room.code);
  if (guestIds.size === 0) return;

  let paidAnyone = false;
  for (const guestId of guestIds) {
    let grant;
    try {
      grant = apply({ roomId: room.id, guestId, delta: 1, reason: "passive", cap: settings.tokenCap });
    } catch (err) {
      if (err instanceof TokenCapExceededError) continue;
      throw err;
    }
    paidAnyone = true;
    const payload: TokenUpdatePayload = {
      guestId,
      balance: grant.balance,
      delta: grant.delta,
      reason: "passive",
    };
    emitToGuest(io, room.code, guestId, SOCKET_EVENTS.TOKEN_UPDATE, payload);
  }

  if (paidAnyone) {
    const toast: ToastPayload = { id: crypto.randomUUID(), message: "🪙 +1 for everyone" };
    io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.TOAST, toast);
  }
}
