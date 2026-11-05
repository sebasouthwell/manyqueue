import type { Server } from "socket.io";
import {
  SOCKET_EVENTS,
  priceFor,
  clampTurnCredit,
  type MineQueueItemView,
  type OnDeckItemView,
  type RotationGuestView,
  type RotationRoomView,
  type HostRotationBoardView,
  type UpcomingItemView,
  type HostUpcomingItemView,
} from "@manyqueue/shared";
import { db, type DB } from "../db/client.js";
import { getOnDeckItems } from "../db/queue.js";
import { getRotationRoster, getMineQueue, getPoolItems, type RotationState } from "../db/rotation.js";
import { getGuestsForRoom, type Guest } from "../db/guests.js";
import { balance } from "../db/tokens.js";
import { getRoomSettings } from "../db/settings.js";
import type { Room } from "../db/rooms.js";
import { emitToGuest, emitToStaff, roomChannel } from "./socket-server.js";
import { buildBallotView, buildHostBallotView } from "./crowd-pick.js";
import { forecastUpcoming } from "./rotation-loop.js";
import { vetoCommitsAt } from "./draft-veto.js";

export function buildMineView(roomId: string, guestId: string, database: DB = db): MineQueueItemView[] {
  const mine = getMineQueue(roomId, guestId, database).map((m) => ({
    id: m.id,
    trackUri: m.trackUri,
    trackName: m.trackName,
    artistName: m.artistName,
    albumArtUrl: m.albumArtUrl,
    durationMs: m.durationMs,
    dedication: m.dedication,
    inPool: false,
  }));
  // Only this guest sees their own pool entry here — max one at a time (§7) — so they can pull it back.
  const pooled = getPoolItems(roomId, database)
    .filter((p) => p.addedBy === guestId)
    .map((p) => ({
      id: p.id,
      trackUri: p.trackUri,
      trackName: p.trackName,
      artistName: p.artistName,
      albumArtUrl: p.albumArtUrl,
      durationMs: p.durationMs,
      dedication: p.dedication,
      inPool: true,
    }));
  return [...mine, ...pooled];
}

/** Rotation order, credit-first — the same priority draft() would pick from, so a guest's index in
 * this array is genuinely "how many turns until yours" (§12's turn card). */
function sortByTurnPriority(roster: RotationState[]): RotationState[] {
  // Same clamp draft() applies before it picks, or a guest back from an empty queue with a big backlog
  // of credit would show further ahead than draft() will actually put them.
  const clamped = roster.map((r) => ({ row: r, credit: r.credit, weight: r.weight }));
  clampTurnCredit(clamped.filter((c) => c.row.active));
  const creditOf = new Map(clamped.map((c) => [c.row, c.credit]));
  return [...roster].sort((a, b) => {
    const aCredit = creditOf.get(a)!;
    const bCredit = creditOf.get(b)!;
    if (bCredit !== aCredit) return bCredit - aCredit;
    const aLast = a.lastTurnAt?.getTime() ?? -Infinity;
    const bLast = b.lastTurnAt?.getTime() ?? -Infinity;
    if (aLast !== bLast) return aLast - bLast;
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });
}

export function buildRotationRoomView(room: Room, database: DB = db): RotationRoomView {
  const onDeckItems = getOnDeckItems(room.id, database);
  const guestById = new Map<string, Guest>(getGuestsForRoom(room.id, database).map((g) => [g.id, g]));
  const mineCountByGuest = new Map<string, number>();
  for (const g of guestById.keys()) mineCountByGuest.set(g, getMineQueue(room.id, g, database).length);

  const onDeck: OnDeckItemView[] = onDeckItems.map((item) => ({
    id: item.id,
    trackName: item.trackName,
    artistName: item.artistName,
    albumArtUrl: item.albumArtUrl,
    durationMs: item.durationMs,
    addedBy: item.anonymous || !item.addedBy ? null : guestGlance(guestById.get(item.addedBy)),
    isMystery: item.anonymous,
    locked: item.status === "locked" || item.status === "playing",
    pickedByCrowd: item.draftedBy === "crowd",
  }));

  const roster = sortByTurnPriority(getRotationRoster(room.id, database).filter((r) => guestById.has(r.guestId)));
  const rotation: RotationGuestView[] = roster.map((r) => {
    const guest = guestById.get(r.guestId)!;
    const count = mineCountByGuest.get(r.guestId) ?? 0;
    return {
      guestId: r.guestId,
      nickname: guest.nickname,
      emoji: guest.emoji,
      count,
      empty: count === 0,
    };
  });

  const upcoming: UpcomingItemView[] = forecastUpcoming(room, database).map((slot) => ({
    kind: slot.kind,
    guestId: slot.kind === "guest" ? slot.ownerId : null,
    addedBy: slot.kind === "guest" && slot.ownerId ? guestGlance(guestById.get(slot.ownerId)) : null,
  }));

  return { onDeck, rotation, upcoming, ballot: buildBallotView(room, database) };
}

function guestGlance(guest: Guest | undefined): { nickname: string; emoji: string } | null {
  return guest ? { nickname: guest.nickname, emoji: guest.emoji } : null;
}

/** Host/co-host only (§9, §15 rotation:host) — every guest's real queue, titles included, in rotation
 * order. Pool songs keep their owner hidden even here (D11) — "See anonymous owners" isn't built. */
export function buildHostRotationBoard(room: Room, database: DB = db): HostRotationBoardView {
  const settings = getRoomSettings(room.id, database);
  const onDeckItems = getOnDeckItems(room.id, database);
  const guestById = new Map<string, Guest>(getGuestsForRoom(room.id, database).map((g) => [g.id, g]));

  const onDeck: OnDeckItemView[] = onDeckItems.map((item) => ({
    id: item.id,
    trackName: item.trackName,
    artistName: item.artistName,
    albumArtUrl: item.albumArtUrl,
    durationMs: item.durationMs,
    addedBy: item.anonymous || !item.addedBy ? null : guestGlance(guestById.get(item.addedBy)),
    isMystery: item.anonymous,
    locked: item.status === "locked" || item.status === "playing",
    pickedByCrowd: item.draftedBy === "crowd",
  }));

  const roster = sortByTurnPriority(getRotationRoster(room.id, database).filter((r) => guestById.has(r.guestId)));
  const guests = roster.map((r) => {
    const guest = guestById.get(r.guestId)!;
    const mine = getMineQueue(room.id, r.guestId, database);
    const price = mine[0] ? priceFor(mine[0].playsTonight, settings.replaySurcharge) + (mine[0].dedication ? 1 : 0) : 0;
    const bal = balance(r.guestId, database);
    return {
      guestId: r.guestId,
      nickname: guest.nickname,
      emoji: guest.emoji,
      weight: r.weight,
      tokenBalance: bal,
      canAfford: !settings.tokenMode || bal >= price,
      empty: mine.length === 0,
      songs: mine.map((m) => ({
        id: m.id,
        trackName: m.trackName,
        artistName: m.artistName,
        albumArtUrl: m.albumArtUrl,
        dedication: m.dedication,
      })),
    };
  });

  const pool = getPoolItems(room.id, database).map((p) => ({
    id: p.id,
    trackName: p.trackName,
    artistName: p.artistName,
    albumArtUrl: p.albumArtUrl,
  }));

  const mineById = new Map(guests.flatMap((g) => g.songs.map((song) => [song.id, song] as const)));
  const upcoming: HostUpcomingItemView[] = forecastUpcoming(room, database).map((slot) => {
    const song = slot.itemId ? mineById.get(slot.itemId) : undefined;
    return {
      kind: slot.kind,
      guestId: slot.kind === "guest" ? slot.ownerId : null,
      addedBy: slot.kind === "guest" && slot.ownerId ? guestGlance(guestById.get(slot.ownerId)) : null,
      itemId: song ? slot.itemId : null,
      trackName: song?.trackName ?? null,
      artistName: song?.artistName ?? null,
      albumArtUrl: song?.albumArtUrl ?? null,
    };
  });

  const commitsAt = vetoCommitsAt(room.id);
  // The window only opens with nothing next on deck, so the forecast's first slot is the pending draft.
  const pendingDraft = commitsAt !== null && upcoming[0] ? { ...upcoming[0], commitsAt } : null;

  return { onDeck, guests, pool, upcoming, ballot: buildHostBallotView(room, database), pendingDraft };
}

/** Just the shared view and the host board — after a Crowd pick vote, which changes nobody's own queue. */
export function broadcastBallotState(io: Server, room: Room, database: DB = db): void {
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.ROTATION_UPDATE, buildRotationRoomView(room, database));
  emitToStaff(io, room.code, SOCKET_EVENTS.ROTATION_HOST_UPDATE, buildHostRotationBoard(room, database));
}

/** Sends everyone the shared Rotation-mode view, staff the full board, and each connected guest their
 * own personal queue — call after anything that changes on deck, a personal queue, or the roster (a
 * draft, an add, a reorder). */
export function broadcastRotationState(io: Server, room: Room, database: DB = db): void {
  io.to(roomChannel(room.code)).emit(SOCKET_EVENTS.ROTATION_UPDATE, buildRotationRoomView(room, database));
  emitToStaff(io, room.code, SOCKET_EVENTS.ROTATION_HOST_UPDATE, buildHostRotationBoard(room, database));
  const weightByGuest = new Map(getRotationRoster(room.id, database).map((r) => [r.guestId, r.weight]));
  for (const guestId of getGuestsForRoom(room.id, database).map((g) => g.id)) {
    emitToGuest(io, room.code, guestId, SOCKET_EVENTS.MINE_UPDATE, buildMineView(room.id, guestId, database));
    // Never sent at all below x1, not just hidden client-side (§8: "weights below x1 are never shown").
    const weight = weightByGuest.get(guestId);
    if (weight && weight > 1) {
      emitToGuest(io, room.code, guestId, SOCKET_EVENTS.MY_WEIGHT_UPDATE, { weight });
    }
  }
}
