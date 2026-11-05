import { sqliteTable, text, integer, real, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Permission, VoteOptionSpec, VoteResult } from "@manyqueue/shared";

export const hosts = sqliteTable("hosts", {
  id: text("id").primaryKey(),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  tokenIv: text("token_iv").notNull(),
  // The same Spotify account's login through the BACKUP Spotify app (a second developer account's
  // client id/secret with its own API quota). A refresh token only works with the app that issued it.
  backupRefreshTokenEnc: text("backup_refresh_token_enc"),
  backupTokenIv: text("backup_token_iv"),
  // Optional PIN that locks the host desk's People section (scrypt-hashed, never stored plain). Not a
  // real auth boundary — the host_session cookie already grants full power — it's a screen-lock against
  // someone at an unattended, already-logged-in laptop handing themselves co-host.
  peoplePinHash: text("people_pin_hash"),
  peoplePinSalt: text("people_pin_salt"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  hostId: text("host_id")
    .notNull()
    .references(() => hosts.id),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "ended"] })
    .notNull()
    .default("active"),
  deviceId: text("device_id"),
  deviceName: text("device_name"),
  fallbackPlaylistUri: text("fallback_playlist_uri"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  exportPlaylistId: text("export_playlist_id"),
  // Rotation mode only: normal on-deck refills filled since the last mystery-pool slot (§5.4, §7) —
  // room-wide runtime state, not a host setting, so it lives here rather than in room_settings.
  mysteryCounter: integer("mystery_counter").notNull().default(0),
});

export const guests = sqliteTable("guests", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  nickname: text("nickname").notNull(),
  emoji: text("emoji").notNull(),
  role: text("role", { enum: ["guest", "cohost"] })
    .notNull()
    .default("guest"),
  muted: integer("muted", { mode: "boolean" }).notNull().default(false),
  // Extra permissions the host handed this guest without making them a co-host.
  perms: text("perms", { mode: "json" }).$type<Permission[]>().notNull().default([]),
  // Announcements are on for everyone by default; staff can take it away from a specific guest.
  canAnnounce: integer("can_announce", { mode: "boolean" }).notNull().default(true),
  // The long-lived device cookie (separate from the guest_session that identifies THIS guest row) and
  // the IP seen at join — the signals a kick blocks against, so clearing just guest_session (or a new
  // private tab) doesn't hand someone a fresh identity on the same phone. Null for guests created
  // before this existed.
  deviceId: text("device_id"),
  lastIp: text("last_ip"),
  kickedAt: integer("kicked_at", { mode: "timestamp" }),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Keyed by IP (this app has no real device fingerprinting) — good enough to
// stop a kicked guest's phone rejoining under a new nickname for the night,
// on the same local Wi-Fi a party actually runs on.
export const blockedDevices = sqliteTable("blocked_devices", {
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  deviceId: text("device_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const roomSettings = sqliteTable("room_settings", {
  roomId: text("room_id")
    .primaryKey()
    .references(() => rooms.id),
  json: text("json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const queueItems = sqliteTable("queue_items", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  trackUri: text("track_uri").notNull(),
  trackName: text("track_name").notNull(),
  artistName: text("artist_name").notNull(),
  albumArtUrl: text("album_art_url"),
  durationMs: integer("duration_ms").notNull(),
  addedBy: text("added_by").references(() => guests.id),
  source: text("source", { enum: ["queue", "fallback"] })
    .notNull()
    .default("queue"),
  status: text("status", {
    // Rotation mode (the Rotation-mode design): mine = a guest's own queue, pool = the mystery lane,
    // on_deck = drafted and waiting to play, in_fight = entered in a "fight for a spot" contest.
    enum: ["pending", "queued", "locked", "playing", "played", "skipped", "contest", "mine", "pool", "on_deck", "in_fight"],
  })
    .notNull()
    .default("queued"),
  paid: integer("paid").notNull().default(0),
  playsTonight: integer("plays_tonight").notNull().default(0),
  pinnedPosition: integer("pinned_position"),
  position: integer("position").notNull(),
  // Rotation mode only: this item's rank in its owner's personal queue (status "mine"), separate from
  // `position` above, which is the Shared-mode queue's ordering.
  minePosition: integer("mine_position"),
  draftedAt: integer("drafted_at", { mode: "timestamp" }),
  draftedBy: text("drafted_by", { enum: ["rotation", "host", "crowd", "mystery", "fight"] }),
  addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
  lockedAt: integer("locked_at", { mode: "timestamp" }),
  startedAt: integer("started_at", { mode: "timestamp" }),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  // Approvals (Block 21): when a still-pending item silently auto-approves
  // (current_track_end − approvalGraceSec), and who/what approved it —
  // distinct from lockedAt above, which is when it was handed off to Spotify.
  approvalLockAt: integer("approval_lock_at", { mode: "timestamp" }),
  approvedBy: text("approved_by"),
  // Block 31: a short "for Sam 🎂" line shown with the song; the host can hide it.
  dedication: text("dedication"),
  dedicationHidden: integer("dedication_hidden", { mode: "boolean" }).notNull().default(false),
  // Block 34: a mystery pick. While `anonymous && !revealed`, added_by is never sent to any client.
  anonymous: integer("anonymous", { mode: "boolean" }).notNull().default(false),
  revealed: integer("revealed", { mode: "boolean" }).notNull().default(false),
  // A skip at 80%+ through the song: still recorded as a skip (history, the activity log, a ban all still
  // say so), but skip-counting stats (skip rate, Certified Skip) leave it out — see isNearEndSkip.
  nearEndSkip: integer("near_end_skip", { mode: "boolean" }).notNull().default(false),
});

export const actionLog = sqliteTable("action_log", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const hearts = sqliteTable("hearts", {
  queueItemId: text("queue_item_id")
    .notNull()
    .references(() => queueItems.id),
  guestId: text("guest_id")
    .notNull()
    .references(() => guests.id),
});

export const votes = sqliteTable("votes", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  type: text("type", { enum: ["skip", "contest", "ban", "guess"] }).notNull(),
  // skip votes target the playing song; contest votes have two candidates and
  // keep them in `options`/`meta` instead.
  targetQueueItemId: text("target_queue_item_id").references(() => queueItems.id),
  status: text("status", { enum: ["open", "passed", "closed"] })
    .notNull()
    .default("open"),
  openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp" }),
  title: text("title"),
  instruction: text("instruction"),
  // Ordered as entered — the first option wins contest ties.
  options: text("options", { mode: "json" }).$type<VoteOptionSpec[]>(),
  // Epoch ms (not a seconds-precision timestamp: votes are timed to the second).
  deadlineAt: integer("deadline_at"),
  result: text("result", { mode: "json" }).$type<VoteResult>(),
  // Server-only data the game handlers need (never sent to clients).
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const voteBallots = sqliteTable(
  "vote_ballots",
  {
    voteId: text("vote_id")
      .notNull()
      .references(() => votes.id),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id),
    optionId: text("option_id"),
    castAt: integer("cast_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ oneBallotPerGuest: uniqueIndex("vote_ballots_vote_guest").on(t.voteId, t.guestId) }),
);

export const tokenEvents = sqliteTable("token_events", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  guestId: text("guest_id")
    .notNull()
    .references(() => guests.id),
  delta: integer("delta").notNull(),
  reason: text("reason", {
    enum: [
      "start",
      "queue_add",
      "replay_surcharge",
      "dedication",
      "contest_entry",
      "anonymous",
      "guess_right",
      "stayed_hidden",
      "refund_reject",
      "refund_expire",
      "refund_contest",
      "passive",
      "grant",
      "penalty",
    ],
  }).notNull(),
  refId: text("ref_id"),
  actor: text("actor"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Reaction totals per song (for the recap and reaction stats) — the TV gets
// the live stream; these are just counters.
export const reactionsAgg = sqliteTable(
  "reactions_agg",
  {
    queueItemId: text("queue_item_id")
      .notNull()
      .references(() => queueItems.id),
    emoji: text("emoji").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.queueItemId, t.emoji] }) }),
);

export const reactionByGuest = sqliteTable(
  "reaction_by_guest",
  {
    queueItemId: text("queue_item_id")
      .notNull()
      .references(() => queueItems.id),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id),
    count: integer("count").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.queueItemId, t.guestId] }) }),
);

// Songs waiting for (or in) a song contest. The song itself is a queue_items
// row with status "contest", so it stays out of the queue, fair order and the
// Spotify handoff until it wins or loses twice.
export const contestPool = sqliteTable("contest_pool", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  queueItemId: text("queue_item_id")
    .notNull()
    .references(() => queueItems.id),
  enteredBy: text("entered_by")
    .notNull()
    .references(() => guests.id),
  losses: integer("losses").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Songs the room voted out for the night. Search dims them and adds are refused.
export const bannedTracks = sqliteTable(
  "banned_tracks",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    trackUri: text("track_uri").notNull(),
    voteId: text("vote_id").references(() => votes.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roomId, t.trackUri] }) }),
);

// Block 39: genre tags per artist, filled in by the AI (Spotify no longer returns artist genres, and its
// batch artist endpoint is closed to apps in development mode). Keyed by the artist's normalised name and
// kept for 30 days, so a song that comes up again costs nothing.
export const genreCache = sqliteTable("genre_cache", {
  artistKey: text("artist_key").primaryKey(),
  genres: text("genres", { mode: "json" }).$type<string[]>().notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

// Block 39: the AI-made party nicknames. The real name always comes first; these sit beside it.
// "pending" waits for the host (or shows itself after 60s), "hidden" was removed by the host.
export const aiNicknames = sqliteTable("ai_nicknames", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  guestId: text("guest_id")
    .notNull()
    .references(() => guests.id),
  nickname: text("nickname").notNull(),
  why: text("why").notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: ["pending", "shown", "hidden"] }).notNull(),
  // Songs finished when it was made: the "at most one change per 16 songs" rule counts from here.
  atFinished: integer("at_finished").notNull().default(0),
  // When the TV announced it (one announcement per song); null until then.
  announcedAt: integer("announced_at", { mode: "timestamp" }),
});

// Block 39 cost guard: AI calls used per room per night.
export const aiUsage = sqliteTable("ai_usage", {
  roomId: text("room_id")
    .primaryKey()
    .references(() => rooms.id),
  nicknameCalls: integer("nickname_calls").notNull().default(0),
  genreCalls: integer("genre_calls").notNull().default(0),
});

// Phase 4 Block 40: labels a guest has earned tonight ("Salsa Pro", "Hitmaker 🎯"...). Kept once earned, so a
// label is announced once and the recap can list it. The name and emoji are stored as they were earned.
export const guestLabels = sqliteTable(
  "guest_labels",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id),
    labelKey: text("label_key").notNull(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    earnedAt: integer("earned_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.guestId, t.labelKey] }) }),
);

// Rotation mode's per-guest turn state (the Rotation-mode design §8, §14) — separate from `guests` since it
// only exists while a room is in Rotation mode, and is reset by a mode switch, not by the guest itself.
export const rotationState = sqliteTable(
  "rotation_state",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    guestId: text("guest_id")
      .notNull()
      .references(() => guests.id),
    credit: integer("credit").notNull().default(0),
    /** ×0.5-×3, host-set; ×1 for everyone by default. */
    weight: real("weight").notNull().default(1),
    lastTurnAt: integer("last_turn_at", { mode: "timestamp" }),
    joinedAt: integer("joined_at", { mode: "timestamp" }).notNull(),
    /** false = inactive (no ping in 10 min) or otherwise dropped from the rotation; keeps their place. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** Crowd pick: ballot rounds in a row this guest's song lost (§6 wildcard after N). 0 after a win. */
    lostRounds: integer("lost_rounds").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roomId, t.guestId] }) }),
);

// Crowd pick (the Rotation-mode design §6, §14): one open ballot per room at a time. It opens as a song starts
// and closes about 20s before it ends; the winner goes on deck. Rows are kept after closing for the log.
export const ballots = sqliteTable("ballots", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.id),
  status: text("status", { enum: ["open", "closed", "cancelled"] }).notNull(),
  openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp" }),
  winnerItemId: text("winner_item_id"),
});

export const ballotEntries = sqliteTable(
  "ballot_entries",
  {
    ballotId: text("ballot_id")
      .notNull()
      .references(() => ballots.id),
    queueItemId: text("queue_item_id").notNull(),
    /** Server-side only: never sent to guests (D11). Kept for mystery songs too, for charging. */
    ownerId: text("owner_id"),
    /** Ballot order = rotation order at opening; "no votes" picks the first live entry. */
    seq: integer("seq").notNull(),
    isMystery: integer("is_mystery", { mode: "boolean" }).notNull().default(false),
    isWildcard: integer("is_wildcard", { mode: "boolean" }).notNull().default(false),
    lostRounds: integer("lost_rounds").notNull().default(0),
    waitingSince: integer("waiting_since").notNull(),
    /** Host pulled it off the ballot (§6): it stays at the top of its owner's queue. */
    pulled: integer("pulled", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({ pk: primaryKey({ columns: [t.ballotId, t.queueItemId] }) }),
);

export const ballotVotes = sqliteTable(
  "ballot_votes",
  {
    ballotId: text("ballot_id")
      .notNull()
      .references(() => ballots.id),
    guestId: text("guest_id").notNull(),
    queueItemId: text("queue_item_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.ballotId, t.guestId] }) }),
);
