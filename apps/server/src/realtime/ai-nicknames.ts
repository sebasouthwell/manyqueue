import type { Server } from "socket.io";
import {
  AI_AUTO_SHOW_MS,
  SOCKET_EVENTS,
  shouldChangeNickname,
  shouldRunBatch,
  AI_MAX_CALLS_PER_NIGHT,
  type AiNicknamePayload,
  type AiNicknameView,
  type AiNicknamesPayload,
  type TakeoverPayload,
} from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { getRoomById } from "../db/rooms.js";
import { getGuestById } from "../db/guests.js";
import { getRoomSettings } from "../db/settings.js";
import type { QueueItem } from "../db/queue.js";
import {
  getAiUsage,
  getNicknameById,
  hideAllNicknamesFor,
  insertNickname,
  latestNicknameFor,
  listAllPendingNicknames,
  listLatestNicknames,
  markNicknameAnnounced,
  setNicknameStatus,
  shownNicknameFor,
  unannouncedShown,
  type AiNicknameRow,
} from "../db/ai-nicknames.js";
import { generateNicknames, type NicknameBatchResult } from "../ai/nicknames.js";
import { isAiConfigured } from "../ai/deepseek.js";
import { emitToGuest, emitToStaff } from "./socket-server.js";
import { showMoment } from "./moments.js";
import { songsFinished } from "./game-rules.js";

const running = new Set<string>();
const autoShowTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** The finished-song count of the last batch per room, so the night-end batch doesn't repeat one. */
const lastBatchAt = new Map<string, number>();

export function view(row: AiNicknameRow): AiNicknameView {
  const guest = getGuestById(row.guestId);
  return { id: row.id, guestId: row.guestId, guestName: guest?.nickname ?? "?", guestEmoji: guest?.emoji ?? "", nickname: row.nickname, why: row.why, status: row.status, generatedAt: row.generatedAt.getTime() };
}

/** Everything staff see: each guest's newest nickname and its status. */
export function staffNicknames(roomId: string): AiNicknameView[] {
  const out: AiNicknameView[] = [];
  for (const row of listLatestNicknames(roomId)) {
    out.push(view(row));
    // A newer nickname waiting for approval doesn't take the shown one off the guest yet: list both.
    if (row.status === "pending") {
      const shown = shownNicknameFor(roomId, row.guestId);
      if (shown) out.push(view(shown));
    }
  }
  return out;
}

/** What one guest shows, or null. */
export function guestNickname(roomId: string, guestId: string): AiNicknamePayload | null {
  const row = shownNicknameFor(roomId, guestId);
  return row ? { nickname: row.nickname, why: row.why } : null;
}

function publishStaff(io: Server, room: Room): void {
  const payload: AiNicknamesPayload = { nicknames: staffNicknames(room.id) };
  emitToStaff(io, room.code, SOCKET_EVENTS.AI_NICKNAMES, payload);
}

function publishGuest(io: Server, room: Room, guestId: string): void {
  emitToGuest(io, room.code, guestId, SOCKET_EVENTS.AI_NICKNAME, guestNickname(room.id, guestId));
}

function publish(io: Server, room: Room, guestIds: string[]): void {
  publishStaff(io, room);
  for (const id of new Set(guestIds)) publishGuest(io, room, id);
}

function armAutoShow(io: Server, roomId: string, nicknameId: string, delayMs: number): void {
  clearTimeout(autoShowTimers.get(nicknameId));
  const timer = setTimeout(() => {
    autoShowTimers.delete(nicknameId);
    const row = getNicknameById(nicknameId);
    const room = getRoomById(roomId);
    if (row?.status === "pending" && room) {
      setNicknameStatus(row.id, "shown");
      publish(io, room, [row.guestId]);
    }
  }, delayMs);
  timer.unref?.();
  autoShowTimers.set(nicknameId, timer);
}

/** After a restart, pending nicknames keep their 60s clock. */
export function initAiNicknames(io: Server): void {
  for (const row of listAllPendingNicknames()) {
    armAutoShow(io, row.roomId, row.id, Math.max(0, row.generatedAt.getTime() + AI_AUTO_SHOW_MS - Date.now()));
  }
}

/** Is the feature on for this room? (a key on the server, and the host hasn't turned it off) */
export function aiNicknamesOn(room: Room): boolean {
  return isAiConfigured() && getRoomSettings(room.id).aiNicknames !== "off";
}

async function runBatch(io: Server, room: Room, opts: { onlyGuestId?: string } = {}): Promise<NicknameBatchResult> {
  if (running.has(room.id)) return { ok: false, reason: "ai_failed" };
  running.add(room.id);
  try {
    const finished = songsFinished(room);
    lastBatchAt.set(room.id, finished);
    const result = await generateNicknames(room.id, opts);
    if (!result.ok) return result;

    const mode = getRoomSettings(room.id).aiNicknames;
    if (mode === "off") return result;
    const touched: string[] = [];
    const shownNow: string[] = []; // guests whose visible nickname just changed (pending ones stay private to staff)
    for (const p of result.proposals) {
      const latest = latestNicknameFor(room.id, p.guestId);
      const current = latest ? { nickname: latest.nickname, atFinished: latest.atFinished } : null;
      // A re-roll (asked for by name) skips the "one change per 16 songs" wait, but must still differ.
      const allowed = opts.onlyGuestId
        ? !current || current.nickname.trim().toLowerCase() !== p.nickname.trim().toLowerCase()
        : shouldChangeNickname(current, p.nickname, finished);
      if (!allowed || !getGuestById(p.guestId)) continue;
      const row = insertNickname({ roomId: room.id, guestId: p.guestId, nickname: p.nickname, why: p.why, status: mode === "auto" ? "shown" : "pending", atFinished: finished });
      if (row.status === "pending") armAutoShow(io, room.id, row.id, AI_AUTO_SHOW_MS);
      touched.push(p.guestId);
      if (row.status === "shown") shownNow.push(p.guestId);
    }
    if (touched.length > 0) publish(io, room, shownNow);
    return result;
  } finally {
    running.delete(room.id);
  }
}

/** Called each time a song finishes (played or skipped): a batch every 8 songs. */
export function maybeRunNicknameBatch(io: Server, room: Room): void {
  if (!aiNicknamesOn(room)) return;
  if (!shouldRunBatch(songsFinished(room), getAiUsage(room.id).nicknameCalls)) return;
  void runBatch(io, room).catch((err) => console.error(`[ai-nicknames:${room.code}] batch failed:`, err));
}

/** One last batch when the night ends (nicknames feed the recap), unless one just ran. */
export function runNightEndBatch(io: Server, room: Room): void {
  if (!aiNicknamesOn(room)) return;
  const finished = songsFinished(room);
  if (finished === 0 || lastBatchAt.get(room.id) === finished) return;
  if (getAiUsage(room.id).nicknameCalls >= AI_MAX_CALLS_PER_NIGHT) return;
  void runBatch(io, room).catch((err) => console.error(`[ai-nicknames:${room.code}] end-of-night batch failed:`, err));
}

// ---- Host actions ----

export function approveNickname(io: Server, room: Room, id: string): boolean {
  const row = getNicknameById(id);
  if (!row || row.roomId !== room.id || row.status !== "pending") return false;
  clearTimeout(autoShowTimers.get(id));
  setNicknameStatus(id, "shown");
  publish(io, room, [row.guestId]);
  return true;
}

/** Hide takes the nickname away everywhere (an older one can't come back either). */
export function hideNickname(io: Server, room: Room, id: string): boolean {
  const row = getNicknameById(id);
  if (!row || row.roomId !== room.id) return false;
  clearTimeout(autoShowTimers.get(id));
  hideAllNicknamesFor(room.id, row.guestId);
  publish(io, room, [row.guestId]);
  return true;
}

/** A fresh nickname for one guest (uses one of the night's AI calls). */
export async function regenerateNickname(io: Server, room: Room, guestId: string): Promise<NicknameBatchResult> {
  if (!aiNicknamesOn(room)) return { ok: false, reason: "not_configured" };
  return runBatch(io, room, { onlyGuestId: guestId });
}

// ---- The TV: one announcement per song ----

const NICKNAME_TV_MS = 5_000;

/** When a song starts: announce ONE newly-visible nickname (a batch spreads over several songs). Songs with
 * their own dedication skip it, so the two never queue behind each other. */
export function announceNextNickname(io: Server, room: Room, item: QueueItem): void {
  if (item.dedication && !item.dedicationHidden) return;
  const next = unannouncedShown(room.id)[0];
  if (!next) return;
  const guest = getGuestById(next.guestId);
  if (!guest || guest.kickedAt) {
    markNicknameAnnounced(next.id); // nobody to announce
    return;
  }
  markNicknameAnnounced(next.id);
  const now = Date.now();
  showMoment(io, room, {
    id: `nickname-${next.id}`,
    kind: "nickname",
    priority: 3,
    payload: { question: guest.nickname, nickname: { name: guest.nickname, emoji: guest.emoji, nickname: next.nickname, why: next.why } } satisfies TakeoverPayload,
    minMs: NICKNAME_TV_MS,
    until: now + NICKNAME_TV_MS,
  });
}
