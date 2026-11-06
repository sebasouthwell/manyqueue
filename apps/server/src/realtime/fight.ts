import type { Server } from "socket.io";
import { pickContestPair } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import { listPoolEntries } from "../db/contest.js";
import { fightsOpen } from "../db/fight.js";
import { getRunningContest, startContest } from "./contest.js";
import { gameSpacing } from "./game-rules.js";
import { recordAction } from "./action-log-broadcast.js";

/**
 * Fights start by themselves: as soon as two guests have a song in, no other vote is live, the one-song
 * gap between games is kept, and there's time for the vote before the handoff (the contest engine's own
 * blocker). Called when a song starts and when someone enters. Nobody has to wait for the host.
 */
export function maybeStartFight(io: Server, room: Room): boolean {
  if (!fightsOpen(room.id)) return false;
  if (getRunningContest(room.id) || !gameSpacing(room).ok) return false;
  const entries = listPoolEntries(room.id);
  if (!pickContestPair(entries.map((e) => ({ id: e.id, enteredBy: e.enteredBy, createdAt: e.createdAt.getTime(), losses: e.losses })))) return false;
  const result = startContest(io, room);
  if (!result.ok) return false;
  recordAction(io, room, { actor: "system", action: "contest_start", detail: "(fight for a spot)" });
  return true;
}
