import { z } from "zod";

export const RoomSettingsSchema = z.object({
  /** Shared: one queue everyone adds to. Rotation: personal per-guest queues drafted by turn — see
   * the Rotation-mode design. Chosen at room creation, switchable later (D1, D2 in that doc). */
  mode: z.enum(["shared", "rotation"]).default("shared"),
  tokenMode: z.boolean().default(true),
  startTokens: z.number().int().min(0).default(3),
  tokenCap: z.number().int().min(1).default(5),
  earnEverySongs: z.number().int().min(1).default(2),
  replaySurcharge: z.number().int().min(0).default(1),
  approvals: z.boolean().default(false),
  approvalGraceSec: z.number().int().min(0).default(15),
  fairOrder: z.boolean().default(true),
  maxSongMin: z.number().int().min(1).nullable().default(null),
  explicit: z.boolean().default(true),
  /** Seconds a guest must wait between adding songs. 0 turns it off. */
  addCooldownSec: z.number().int().min(0).default(120),
  /** Whole percent (not 0-1) — how many of the currently-active guests must
   * vote skip before it takes effect. A floor of 3 votes always applies
   * underneath this regardless of percent, so a near-empty room can't be
   * skip-bombed by one or two people. */
  skipVotePercent: z.number().int().min(10).max(100).default(33),
  /** How long a song contest's vote runs. */
  contestSeconds: z.number().int().min(10).max(120).default(30),
  /** Minutes a guest waits between ban votes they call. */
  banCooldownMin: z.number().int().min(1).max(240).default(20),
  /** Every song added is a mystery pick (free): nobody's adder is shown until the room guesses. */
  guessWhoMode: z.boolean().default(false),
  /** On about one ordinary song in five, a light 20s "who queued this?" vote opens for fun (no tokens). */
  quickGuess: z.boolean().default(false),
  /** Start a song contest by itself every N finished songs when two guests have songs in the pool. */
  autoContest: z.boolean().default(false),
  autoContestEverySongs: z.number().int().min(1).max(20).default(3),
  /** AI party nicknames: off, the host approves each one, or automatic. Needs a DeepSeek key on the server. */
  aiNicknames: z.enum(["off", "approve", "auto"]).default("approve"),
  /** The TV background follows the song's genre. */
  tvScenes: z.boolean().default(true),
  /** Tokens a co-host may hand out (positive grants) per rolling hour. The host has no limit — this
   * guards the room's token economy against a co-host giving too much away. */
  cohostGrantHourlyLimit: z.number().int().min(0).max(50).default(5),
  /** Penalties a co-host may hand out per rolling hour. A spam guard, not an economy one — penalties
   * floor at 0 regardless — so it's a call count, not a token total. */
  cohostPenaltyHourlyLimit: z.number().int().min(0).max(50).default(10),
  /** Rotation mode only: roughly every Nth on-deck refill draws from the mystery pool instead of the
   * rotation (the Rotation-mode design §7). 0 turns mystery slots off. */
  mysteryEvery: z.number().int().min(0).max(8).default(5),
  /** Rotation mode only: max songs in a guest's own queue at once (§5.1, §13). Adding is free either way. */
  personalQueueCap: z.number().int().min(3).max(20).default(10),
  /** Rotation mode only (§9): automatic drafts on its own; auto_veto shows the host "Drafting now…"
   * for the 15s before each draft commits, with Swap / Skip (draft-veto.ts); dj disables
   * automatic drafting entirely, host-only via Draft now (falls back to a house pick if on deck empties). */
  draftingStyle: z.enum(["automatic", "auto_veto", "dj"]).default("auto_veto"),
  /** Rotation mode only: who pays by default when the host uses Draft now — a broke guest is always on
   * the house regardless (§9). */
  hostDraftPays: z.enum(["guest", "house"]).default("guest"),
  /** Rotation mode only (§6, D5): how the next song is chosen. "crowd" = Crowd pick — guests vote on a
   * ballot of everyone's top song while the current one plays. */
  nextSongMethod: z.enum(["rotation", "crowd"]).default("rotation"),
  /** Crowd pick: most songs on one ballot (§13). */
  ballotSize: z.number().int().min(3).max(8).default(6),
  /** Crowd pick: the vote closes this many seconds before the song ends (§13). */
  ballotClosesSec: z.number().int().min(15).max(45).default(20),
  /** Crowd pick: show "waited N rounds" on each candidate (D14). */
  ballotShowsWait: z.boolean().default(false),
  /** Crowd pick: a song that has lost this many rounds in a row becomes a 🔥 Wildcard and plays if it
   * loses once more (§6). */
  wildcardAfter: z.number().int().min(2).max(5).default(3),
});

export type RoomSettings = z.infer<typeof RoomSettingsSchema>;

export const DEFAULT_ROOM_SETTINGS: RoomSettings = RoomSettingsSchema.parse({});

/** For PATCH endpoints — every field optional, still validated when present. */
export const RoomSettingsPatchSchema = RoomSettingsSchema.partial();
export type RoomSettingsPatch = z.infer<typeof RoomSettingsPatchSchema>;
