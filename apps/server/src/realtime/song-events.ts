import type { Server } from "socket.io";
import { autoContestDue, rollQuickGuess } from "@manyqueue/shared";
import type { Room } from "../db/rooms.js";
import type { QueueItem } from "../db/queue.js";
import { getRoomSettings } from "../db/settings.js";
import { announceDedication } from "./moments.js";
import { startCasualGuess, startGuessVote } from "./guess.js";
import { getRunningContest, startContest } from "./contest.js";
import { maybeStartFight } from "./fight.js";
import { gameSpacing, songsFinished } from "./game-rules.js";
import { recordAction } from "./action-log-broadcast.js";
import { announceNextNickname } from "./ai-nicknames.js";
import { onSongStartedScene } from "./scenes.js";

/**
 * Everything that happens when a song starts playing, in one place: its
 * dedication splash, the mystery-pick guess vote, and (if the room turned it
 * on) a casual "who queued this?" on roughly one ordinary song in five.
 */
export function onSongStarted(
  io: Server,
  room: Room,
  item: QueueItem,
  random: () => number = Math.random,
  opts: { skipDedication?: boolean } = {},
): void {
  if (!opts.skipDedication) announceDedication(io, room, item, { splash: true });
  announceNextNickname(io, room, item);
  onSongStartedScene(io, room);
  startGuessVote(io, room, item);
  if (getRoomSettings(room.id).quickGuess && rollQuickGuess(random)) startCasualGuess(io, room, item);
  if (!maybeAutoContest(io, room)) maybeStartFight(io, room);
}

/**
 * If the host turned on auto-contest, start one every N finished songs, as a
 * song begins (the most time left for it to finish before the next track is
 * handed to Spotify). It only runs when two guests have songs in the pool, no
 * vote is live, and the one-song gap between games is respected.
 */
export function maybeAutoContest(io: Server, room: Room): boolean {
  const settings = getRoomSettings(room.id);
  if (!settings.autoContest) return false;
  if (!autoContestDue(songsFinished(room), settings.autoContestEverySongs)) return false;
  if (getRunningContest(room.id) || !gameSpacing(room).ok) return false;
  const result = startContest(io, room);
  if (!result.ok) return false;
  recordAction(io, room, { actor: "system", action: "contest_start", detail: "(automatic)" });
  return true;
}
