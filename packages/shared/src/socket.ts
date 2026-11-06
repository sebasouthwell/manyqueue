import type { RoomSettings } from "./room-settings.js";
import type { ActorRole } from "./roles.js";
import type { VoteOpenedPayload } from "./vote.js";
import type { Permission } from "./permissions.js";
import type { SceneId } from "./scenes.js";

export type ClientRole = "host" | "tv" | "guest";

export interface RoomJoinPayload {
  code: string;
  role: ClientRole;
  guestId?: string;
}

export interface ToastPayload {
  id: string;
  message: string;
  emoji?: string;
  /** A moment worth a bigger, longer, celebratory notification (e.g. a host
   * grants tokens) instead of the routine small top pill. */
  big?: boolean;
  /** Explicit opt-in for guest phones — TV shows every toast broadcast to
   * the room regardless (it's ambient background info there), but most
   * room-wide toasts (someone joined, a skip) are too frequent/low-value to
   * interrupt every guest's screen. Defaults to false: TV-only. */
  guestVisible?: boolean;
  /** Set on "someone joined" toasts so the TV can merge a burst of them. */
  join?: { emoji: string; nickname: string };
}

export interface RoomStateSnapshot {
  code: string;
  name: string;
  status: "active" | "ended";
  connected: { host: number; tv: number; guest: number };
  settings: RoomSettings;
  songsUntilNextToken: number;
  /** Votes still open when this snapshot was taken — how a reconnecting
   * phone learns what is live (and skips what already ended). */
  activeVotes?: VoteOpenedPayload[];
  /** The speaker volume (0-100) as last seen from Spotify, or null when unknown. */
  volumePercent?: number | null;
  /** Spotify has rate-limited the app until this time (epoch ms); playback, search and the speaker list are paused. */
  spotifyBlockedUntil?: number | null;
  /** Spotify refused the saved login or credentials: the host must log in with Spotify again. */
  spotifyAuthFailed?: boolean;
  /** A backup Spotify app is configured but the host hasn't logged in through it yet. */
  spotifyBackupNeedsLogin?: boolean;
  /** The server has an AI key: the AI nickname settings and cards make sense. */
  aiNicknamesAvailable?: boolean;
  /** Once the night has ended: the key for the recap link, so a phone or TV that reconnects can still show it. */
  recapKey?: string;
  /** The genre scene for the playing song (only the TV uses it). */
  scene?: SceneId | null;
  /** The guest with the most songs added tonight (mystery picks aren't counted), once there are at least two. */
  mostActive?: { nickname: string; emoji: string; songs: number } | null;
  updatedAt: number;
}

export interface RoleChangedPayload {
  guestId: string;
  role: ActorRole;
  /** Their extra permissions after the change. */
  perms?: Permission[];
}

/** action_log row, resolved server-side into one display-ready label (same
 * pattern as TokenActivityItem) — e.g. "⭐ Jake granted Maya 1 🪙 — Won the
 * dance-off" — rather than raw actor/target ids the client has to resolve. */
export interface ActionLogEntry {
  id: string;
  action: string;
  label: string;
  createdAt: number;
}

/** foreignAhead 0 means the warning cleared. */
export interface QueueWarningPayload {
  foreignAhead: number;
}

export interface GuestRemovedPayload {
  reason: "kicked";
}

export interface MutedChangedPayload {
  muted: boolean;
}

/** Sent privately to a guest when staff grants or takes away their ability to announce. */
export interface AnnounceAllowedChangedPayload {
  canAnnounce: boolean;
}

/** Sent privately to a guest when the host renames them. */
export interface IdentityChangedPayload {
  nickname: string;
  emoji: string;
}

export interface PingPayload {
  clientTime: number;
}

export interface PongPayload {
  clientTime: number;
  serverTime: number;
}

export interface PlaybackUpdatePayload {
  isPlaying: boolean;
  trackUri: string | null;
  progressMs: number;
  durationMs: number;
  sampledAt: number;
}

export interface SpeakerStatusPayload {
  status: "connected" | "disconnected" | "moved";
  movedToDeviceName: string | null;
}

/** SHE IS DEFROSTING. Spotify is held paused for `durationMs` while the TV ices over and shatters. */
export interface DefrostPayload {
  queueItemId: string;
  /** The song's dedication, shown in place of the warning. */
  dedication: string | null;
  /** Who dedicated it (null when anonymous or no dedication). */
  from: string | null;
  durationMs: number;
}

export interface RoomEndedPayload {
  songCount: number;
  playlistUrl: string | null;
  /** The playlist is still being built; its link follows in room:export. */
  exportPending?: boolean;
  /** The unguessable key in the recap link (/rooms/:code/recap?key=...). */
  recapKey?: string;
}

/** The end-of-night playlist finished (or failed: playlistUrl is null). */
export interface RoomExportPayload {
  playlistUrl: string | null;
}

export const SOCKET_EVENTS = {
  ROOM_JOIN: "room:join",
  STATE_REQUEST: "state:request",
  STATE_FULL: "state:full",
  QUEUE_UPDATE: "queue:update",
  PLAYBACK_UPDATE: "playback:update",
  SPEAKER_STATUS: "speaker:status",
  GUEST_JOINED: "guest:joined",
  /** Staff only: a guest's token balance changed (grant, spend, refund, passive income...). */
  GUEST_TOKENS: "guest:tokens",
  /** To one guest: their own AI nickname (or null once it is hidden). */
  AI_NICKNAME: "ai:nickname",
  /** To staff: every guest's newest AI nickname, with its status (pending ones wait for approval). */
  AI_NICKNAMES: "ai:nicknames",
  /** To the TV: the genre scene for the playing song (null = the plain background). */
  SCENE: "scene:change",
  VOTE_TALLY: "vote:tally",
  VOTE_OPENED: "vote:opened",
  VOTE_CLOSED: "vote:closed",
  ROOM_ENDED: "room:ended",
  /** To the room: the November Mariah moment (ice over the TV, then she starts from the top). */
  DEFROST: "holiday:defrost",
  ROOM_EXPORT: "room:export",
  SPOTIFY_STATUS: "spotify:status",
  SETTINGS_UPDATE: "settings:update",
  TOKEN_UPDATE: "token:update",
  ROLE_CHANGED: "role:changed",
  ACTION_LOGGED: "action:logged",
  GUEST_KICKED: "guest:kicked",
  IDENTITY_CHANGED: "identity:changed",
  MUTED_CHANGED: "muted:changed",
  ANNOUNCE_ALLOWED_CHANGED: "announce:changed",
  CONTEST_POOL: "contest:pool",
  GAMES_STATE: "games:state",
  GUESS_RESULT: "guess:result",
  VOLUME_UPDATE: "volume:update",
  REACTION: "reaction",
  REACTION_SEND: "reaction:send",
  MOMENT_SHOW: "moment:show",
  MOMENT_END: "moment:end",
  QUEUE_WARNING: "queue:warning",
  /** Rotation mode: to one guest, their own personal queue in full. */
  MINE_UPDATE: "mine:update",
  /** Rotation mode: to one guest, privately — their own turn weight, for the "⭐ boost" card (§8: only
   * shown above ×1; a weight below ×1 is never revealed to the guest it belongs to). */
  MY_WEIGHT_UPDATE: "weight:mine",
  /** To one guest, privately: how glitchy the host has made their app (easter egg). */
  GLITCH_UPDATE: "glitch:mine",
  /** Rotation mode: to everyone — on deck plus the rotation order, counts only. */
  ROTATION_UPDATE: "rotation:update",
  /** Rotation mode: to the host and co-hosts only — the full Queues board with real song titles. */
  ROTATION_HOST_UPDATE: "rotation:host",
  TOAST: "toast",
  DEV_TOAST: "dev:toast",
  PING: "ping",
  PONG: "pong",
} as const;


/** To one guesser, privately, when the mystery pick is revealed. */
export interface GuessResultPayload {
  correct: boolean;
  adder: { nickname: string; emoji: string };
  /** Tokens earned: 1 for a right guess, else 0. */
  delta: number;
}

export interface ContestPoolEntryView {
  id: string;
  queueItemId: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  /** Null for a mystery pick: nobody is told who entered it. */
  enteredBy: { id: string; nickname: string; emoji: string } | null;
  mystery?: boolean;
  losses: number;
  createdAt: number;
}

/** To the host and co-hosts: what's waiting in the contest pool and whether a vote is running. */
export interface ContestPoolPayload {
  entries: ContestPoolEntryView[];
  running: { voteId: string; deadlineAt: number } | null;
  /** Why "Start" would fail right now, or null when it would work. */
  blocker: string | null;
  /** Songs until the next auto-contest is due, or null when auto-contest is off. */
  nextAutoInSongs?: number | null;
  /** Songs that must finish before another game may start (the one-song gap between games). */
  spacingSongs?: number;
}

export interface VolumeUpdatePayload {
  percent: number | null;
}

export interface ScenePayload {
  scene: SceneId | null;
}

export interface AiNicknamePayload {
  nickname: string;
  why: string;
}

export interface AiNicknameView {
  id: string;
  guestId: string;
  /** The guest's real name and emoji, so staff see who a nickname is for (the real name always comes first). */
  guestName: string;
  guestEmoji: string;
  nickname: string;
  why: string;
  status: "pending" | "shown" | "hidden";
  generatedAt: number;
}

export interface AiNicknamesPayload {
  nicknames: AiNicknameView[];
}

export interface GuestTokensPayload {
  guestId: string;
  balance: number;
}

export interface SpotifyStatusPayload {
  blockedUntil?: number | null;
  authFailed?: boolean;
  backupNeedsLogin?: boolean;
}
