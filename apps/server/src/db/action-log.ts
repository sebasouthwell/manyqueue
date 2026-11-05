import crypto from "node:crypto";
import { eq, desc } from "drizzle-orm";
import type { ActionLogEntry } from "@manyqueue/shared";
import { db as defaultDb, type DB, type DBOrTx } from "./client.js";
import { actionLog } from "./schema.js";
import { getGuestById } from "./guests.js";
import type { Room } from "./rooms.js";

/** Append-only log of host/co-host/system actions. `detail` is a pre-composed
 * fragment written by the caller (e.g. `"Maya"`, `'"Song Name"'`,
 * `"Maya +1 🪙 — Won the dance-off"`) — actor name resolution (with the ⭐
 * co-host prefix) happens once, centrally, at read time in
 * getRecentActionLog. */
export function logAction(
  params: {
    roomId: string;
    actor: string;
    action: string;
    target?: string;
    detail?: string;
  },
  database: DBOrTx = defaultDb,
): void {
  database
    .insert(actionLog)
    .values({
      id: crypto.randomUUID(),
      roomId: params.roomId,
      actor: params.actor,
      action: params.action,
      target: params.target ?? null,
      detail: params.detail ?? null,
      createdAt: new Date(),
    })
    .run();
}

const ACTION_VERBS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  auto_approve: "auto-approved",
  remove: "removed",
  skip: "skipped",
  promote: "promoted",
  demote: "demoted",
  grant: "granted",
  penalty: "docked",
  kick: "kicked",
  mute: "muted",
  unmute: "unmuted",
  rename: "renamed",
  veto: "vetoed",
  resync: "resynced",
  perms: "set permissions for",
  ban: "banned",
  ban_end: "ended the ban vote early",
  guess_end: "ended the guess early",
  pause: "paused the music",
  resume: "resumed the music",
  contest_start: "started the song contest",
  contest_end: "ended the song contest early",
  contest_remove: "removed from the contest pool",
  dedication_hide: "hid the dedication on",
  dedication_show: "showed the dedication on",
  announce: "announced",
  announce_allow: "allowed announcements for",
  announce_block: "blocked announcements for",
  ballot_pull: "pulled",
  draft_skip: "skipped",
  rotation_draft: "drafted",
  rotation_skip: "skipped the next turn of",
  rotation_weight: "set the turn weight of",
};

export function resolveActorName(actorId: string, room: Room): string {
  if (actorId === "system") return "Auto";
  if (actorId === room.hostId) return "Host";
  const guest = getGuestById(actorId);
  if (!guest) return "Someone";
  return guest.role === "cohost" ? `⭐ ${guest.nickname}` : guest.nickname;
}

/** Pure — composes the same display label getRecentActionLog resolves from a
 * stored row, but from fresh params, so a just-written entry can be broadcast
 * live without a round trip back through the DB. */
export function composeActionLabel(
  actorId: string,
  action: string,
  detail: string | undefined,
  room: Room,
): string {
  const actorName = resolveActorName(actorId, room);
  const verb = ACTION_VERBS[action] ?? action;
  return detail ? `${actorName} ${verb} ${detail}` : `${actorName} ${verb}`;
}

export function getRecentActionLog(room: Room, limit = 20, database: DB = defaultDb): ActionLogEntry[] {
  const rows = database
    .select()
    .from(actionLog)
    .where(eq(actionLog.roomId, room.id))
    .orderBy(desc(actionLog.createdAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    label: composeActionLabel(row.actor, row.action, row.detail ?? undefined, room),
    createdAt: row.createdAt.getTime(),
  }));
}
