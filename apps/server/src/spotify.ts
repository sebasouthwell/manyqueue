import crypto from "node:crypto";
import { skipsToReach } from "@manyqueue/shared";
import {
  getHostById,
  getDecryptedRefreshToken,
  updateRefreshToken,
  type CredentialSlot,
} from "./db/hosts.js";

export type { CredentialSlot };

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
// Overridable (read lazily, since .env is loaded after imports) so tests can point at a fake Spotify.
const tokenUrl = () => process.env.SPOTIFY_TOKEN_URL ?? "https://accounts.spotify.com/api/token";
const apiBase = () => process.env.SPOTIFY_API_BASE ?? "https://api.spotify.com/v1";

export const SCOPES = [
  "user-read-private", // required for the `product` field on /me, used for the Premium check
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-modify-private",
  "playlist-modify-public",
  "playlist-read-private", // required to read tracks from a private/collaborative playlist (fallback playlist)
  "playlist-read-collaborative",
].join(" ");

export class SpotifyQuotaError extends Error {
  /** How long Spotify asked us to stay away, in seconds. */
  retryAfterSec: number;
  /** True when it was our own read budget that said no, not Spotify. */
  local: boolean;
  constructor(retryAfterSec = 0, local = false) {
    super(`Spotify API quota exceeded (retry in ${retryAfterSec}s)`);
    this.name = "SpotifyQuotaError";
    this.retryAfterSec = retryAfterSec;
    this.local = local;
  }
}

/** Spotify refused the saved login or the app's credentials: the host has to log in again. */
export class SpotifyAuthError extends Error {
  constructor(detail = "") {
    super(`Spotify login not accepted${detail ? `: ${detail}` : ""}`);
    this.name = "SpotifyAuthError";
  }
}

// ---------------------------------------------------------------------------------------------
// Two Spotify apps. Since July 2026 a Development-mode app's API quota is shared by every app of
// one developer ACCOUNT, so a second app on the same account doesn't help; a second developer
// account does. The "primary" app is preferred; when it is rate-limited (or its login is refused)
// calls go through the "backup" app instead, and drift back to primary once it recovers. A refresh
// token only works with the app that issued it, so the host logs in once through each app.
// ---------------------------------------------------------------------------------------------
const SLOTS: CredentialSlot[] = ["primary", "backup"];
const ENV_KEYS: Record<CredentialSlot, { id: string; secret: string }> = {
  primary: { id: "SPOTIFY_CLIENT_ID", secret: "SPOTIFY_CLIENT_SECRET" },
  backup: { id: "BACKUP_CLIENT_ID", secret: "BACKUP_SECRET_ID" },
};

function credsFor(slot: CredentialSlot): { id: string; secret: string } | null {
  const id = process.env[ENV_KEYS[slot].id]?.trim();
  const secret = process.env[ENV_KEYS[slot].secret]?.trim();
  return id && secret ? { id, secret } : null;
}

function credsOrThrow(slot: CredentialSlot): { id: string; secret: string } {
  const creds = credsFor(slot);
  if (!creds) throw new Error(`${ENV_KEYS[slot].id} / ${ENV_KEYS[slot].secret} is not set`);
  return creds;
}

export function isBackupConfigured(): boolean {
  return credsFor("backup") !== null;
}

type ApiGroup = "player" | "default";

interface SlotState {
  /** When Spotify last refused this app's login/credentials (0 = fine). */
  authFailedAt: number;
  /** The host never logged in through this app, so there is nothing to refresh. */
  noToken: boolean;
  /** Spotify told this app to stay away until then. Player endpoints (/me/player...) and everything
   * else are separate groups: the player was seen blocked while search and lookups kept working. */
  blockedUntil: Record<ApiGroup, number>;
  /** Timestamps of our own recent calls, for the local read budget. */
  callLog: Record<ApiGroup, number[]>;
}

function newSlotState(): SlotState {
  return { authFailedAt: 0, noToken: false, blockedUntil: { player: 0, default: 0 }, callLog: { player: [], default: [] } };
}

const slotState: Record<CredentialSlot, SlotState> = { primary: newSlotState(), backup: newSlotState() };

const AUTH_RETRY_COOLDOWN_MS = 60_000;
const MAX_INLINE_RETRY_SEC = 5;
const SPOTIFY_TIMEOUT_MS = 12_000;

export interface SpotifyStatus {
  /** Playback control is blocked on every usable app until then. */
  blockedUntil: number | null;
  /** No app has a login Spotify accepts: the host has to log in again. */
  authFailed: boolean;
  /** A backup app is configured but the host never logged in through it. */
  backupNeedsLogin: boolean;
}

let onStatusChange: ((status: SpotifyStatus) => void) | null = null;
let lastStatusJson = "";

/** Slots that could carry a call right now, best first (primary preferred). */
function candidateSlots(): CredentialSlot[] {
  return SLOTS.filter((slot) => credsFor(slot) !== null && !slotState[slot].noToken);
}

/** Slots whose login is currently accepted. */
function healthySlots(): CredentialSlot[] {
  return candidateSlots().filter((slot) => slotState[slot].authFailedAt === 0);
}

function slotBlockedFor(slot: CredentialSlot, group: ApiGroup): number | null {
  const until = slotState[slot].blockedUntil[group];
  return until > Date.now() ? until : null;
}

/** Until when this kind of call can't be made through ANY usable app, or null. */
export function getSpotifyBlockedUntil(group: ApiGroup = "player"): number | null {
  const slots = healthySlots();
  if (slots.length === 0) return null; // a login problem, not a rate limit
  const blocks = slots.map((slot) => slotBlockedFor(slot, group));
  if (blocks.some((b) => b === null)) return null;
  return Math.min(...(blocks as number[]));
}

export function getSpotifyAuthFailed(): boolean {
  return healthySlots().length === 0;
}

export function getSpotifyStatus(): SpotifyStatus {
  return {
    blockedUntil: getSpotifyBlockedUntil("player"),
    authFailed: getSpotifyAuthFailed(),
    backupNeedsLogin: isBackupConfigured() && slotState.backup.noToken,
  };
}

/** Called with the full status whenever any part of it changes (rate limit, login, backup app). */
export function onSpotifyStatusChange(cb: (status: SpotifyStatus) => void): void {
  onStatusChange = cb;
}

function notifyStatus(): void {
  const status = getSpotifyStatus();
  const json = JSON.stringify(status);
  if (json === lastStatusJson) return;
  lastStatusJson = json;
  onStatusChange?.(status);
}

/** Startup: does any host already have a backup login? (Otherwise the UI offers to set one up.) */
export function initSpotifyCredentials(backupLoginExists: boolean): void {
  slotState.backup.noToken = isBackupConfigured() && !backupLoginExists;
  lastStatusJson = JSON.stringify(getSpotifyStatus());
}

/** Called after a successful Spotify login through one app: the new tokens are good. */
export function resetSpotifyAuthFailure(slot: CredentialSlot = "primary"): void {
  for (const key of [...accessTokenCache.keys()]) if (key.startsWith(`${slot}:`)) accessTokenCache.delete(key);
  slotState[slot].authFailedAt = 0;
  slotState[slot].noToken = false;
  notifyStatus();
}

function setAuthFailed(slot: CredentialSlot, failed: boolean): void {
  slotState[slot].authFailedAt = failed ? Date.now() : 0;
  notifyStatus();
}

function blockSlot(slot: CredentialSlot, group: ApiGroup, retryAfterSec: number): void {
  slotState[slot].blockedUntil[group] = Date.now() + retryAfterSec * 1000;
  notifyStatus();
  // Tell clients again the moment the block is over (unref: never keeps the process alive).
  setTimeout(notifyStatus, Math.min(retryAfterSec * 1000 + 50, 2 ** 31 - 1)).unref?.();
}

function groupOf(path: string): ApiGroup {
  return path.startsWith("/me/player") ? "player" : "default";
}

// Our own budget for READS, so a bug or a busy night can't burn Spotify's quota. Actions a person
// asked for (play, skip, queue, volume) are never refused here. Spotify doesn't publish its numbers;
// these are modest. Each app has its own quota, so each has its own budget.
const READ_BUDGET: Record<ApiGroup, { max: number; windowMs: number }> = {
  player: { max: 40, windowMs: 60_000 },
  default: { max: 120, windowMs: 60_000 },
};

function noteCall(slot: CredentialSlot, group: ApiGroup, isRead: boolean): void {
  const { max, windowMs } = READ_BUDGET[group];
  const now = Date.now();
  const log = slotState[slot].callLog[group];
  while (log.length > 0 && now - log[0]! > windowMs) log.shift();
  if (isRead && log.length >= max) {
    throw new SpotifyQuotaError(Math.max(1, Math.ceil((log[0]! + windowMs - now) / 1000)), true);
  }
  log.push(now);
}

/** Test hook: forget all block/budget/login state. */
export function resetSpotifyLimiterForTests(): void {
  slotState.primary = newSlotState();
  slotState.backup = newSlotState();
  accessTokenCache.clear();
  inflight.clear();
  devicesCache.clear();
  lastStatusJson = "";
  onStatusChange = null;
}

/** Callers asking for the same thing at the same moment share one Spotify call. */
const inflight = new Map<string, Promise<unknown>>();
function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(64));
}

export function generateCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return base64url(crypto.randomBytes(16));
}

export function buildAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  slot?: CredentialSlot;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", credsOrThrow(params.slot ?? "primary").id);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", params.codeChallenge);
  return url.toString();
}

function basicAuthHeader(slot: CredentialSlot): string {
  const { id, secret } = credsOrThrow(slot);
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export async function exchangeCodeForToken(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  slot?: CredentialSlot;
}): Promise<TokenResponse> {
  const res = await fetch(tokenUrl(), {
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(params.slot ?? "primary"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<TokenResponse>;
}

async function refreshAccessToken(slot: CredentialSlot, refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(tokenUrl(), {
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(slot),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // 400 = Spotify refused the credentials or the saved login (invalid_client / invalid_grant).
    if (res.status === 400 || res.status === 401) throw new SpotifyAuthError(body.slice(0, 120));
    throw new Error(`Spotify token refresh failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  product: "premium" | "free" | "open" | string;
}

export async function fetchProfile(accessToken: string): Promise<SpotifyProfile> {
  const res = await fetch(`${apiBase()}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify profile fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<SpotifyProfile>;
}

const accessTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getAccessToken(hostId: string, slot: CredentialSlot = "primary"): Promise<string> {
  const cacheKey = `${slot}:${hostId}`;
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }

  // After a refused refresh, don't ask again for a minute: every poll would otherwise hit
  // Spotify's token endpoint with the same bad credentials.
  const failedAt = slotState[slot].authFailedAt;
  if (failedAt > 0 && Date.now() - failedAt < AUTH_RETRY_COOLDOWN_MS) throw new SpotifyAuthError();

  const host = getHostById(hostId);
  if (!host) throw new Error(`Unknown host ${hostId}`);

  const refreshToken = getDecryptedRefreshToken(host, slot);
  if (!refreshToken) {
    // Never logged in through this app (only the backup can be in this state).
    slotState[slot].noToken = true;
    notifyStatus();
    throw new SpotifyAuthError("no login for this Spotify app yet");
  }

  let tokenRes: TokenResponse;
  try {
    tokenRes = await refreshAccessToken(slot, refreshToken);
  } catch (err) {
    if (err instanceof SpotifyAuthError) setAuthFailed(slot, true);
    throw err;
  }
  if (slotState[slot].authFailedAt !== 0) setAuthFailed(slot, false);

  if (tokenRes.refresh_token) {
    updateRefreshToken(hostId, tokenRes.refresh_token, slot);
  }

  accessTokenCache.set(cacheKey, {
    accessToken: tokenRes.access_token,
    expiresAt: Date.now() + tokenRes.expires_in * 1000,
  });
  return tokenRes.access_token;
}

/** One Spotify API call. Goes through the primary app; if that one is rate-limited, over our own
 * budget, or has a refused login, the same call is made through the backup app instead. */
export async function spotifyFetch(hostId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const group = groupOf(path);
  const isRead = (init.method ?? "GET") === "GET";
  const slots = candidateSlots();
  if (slots.length === 0) throw new SpotifyAuthError();

  let refusal: Error | null = null;
  for (const slot of slots) {
    const blocked = slotBlockedFor(slot, group);
    if (blocked !== null) {
      refusal ??= new SpotifyQuotaError(Math.ceil((blocked - Date.now()) / 1000));
      continue;
    }
    try {
      noteCall(slot, group, isRead);
    } catch (err) {
      refusal ??= err as Error;
      continue;
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(hostId, slot);
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        refusal ??= err;
        continue;
      }
      throw err;
    }

    const send = () =>
      fetch(`${apiBase()}${path}`, {
        signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    let res = await send();

    if (res.status === 429) {
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? "1") || 1;
      if (retryAfterSec <= MAX_INLINE_RETRY_SEC) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
        res = await send();
      } else {
        blockSlot(slot, group, retryAfterSec);
        refusal = new SpotifyQuotaError(retryAfterSec); // try the other app, if there is one
        continue;
      }
    }

    if (!res.ok) {
      const body = await res.clone().text();
      try {
        if (JSON.parse(body)?.error?.reason === "QUOTA_EXCEEDED") throw new SpotifyQuotaError();
      } catch (e) {
        if (e instanceof SpotifyQuotaError) throw e;
      }
    }
    return res;
  }

  throw refusal ?? new SpotifyAuthError();
}

interface SpotifyTrackItem {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { images: { url: string }[]; release_date: string };
  duration_ms: number;
  explicit?: boolean;
}

interface SpotifySearchResponse {
  tracks: { items: SpotifyTrackItem[]; total: number };
}

export interface SearchTrack {
  uri: string;
  name: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  releaseYear: number | null;
  explicit: boolean;
}

/** One track's metadata — for re-checking song rules server-side instead of
 * trusting duration/explicit values a client sent. */
export async function getTrackInfo(
  hostId: string,
  uri: string,
): Promise<{ durationMs: number; explicit: boolean } | null> {
  const id = uri.split(":").pop();
  if (!id) return null;
  const res = await spotifyFetch(hostId, `/tracks/${id}`);
  if (!res.ok) return null;
  const data = (await res.json()) as SpotifyTrackItem;
  return { durationMs: data.duration_ms, explicit: !!data.explicit };
}

export async function searchTracks(
  hostId: string,
  query: string,
  offset: number,
  limit = 10,
): Promise<{ tracks: SearchTrack[]; total: number }> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(limit),
    offset: String(offset),
  });
  const res = await spotifyFetch(hostId, `/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Spotify search failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as SpotifySearchResponse;
  const tracks = data.tracks.items.map((item) => ({
    uri: item.uri,
    name: item.name,
    artistName: item.artists.map((a) => a.name).join(", "),
    albumArtUrl: item.album.images[0]?.url ?? null,
    durationMs: item.duration_ms,
    releaseYear: item.album.release_date ? Number(item.album.release_date.slice(0, 4)) : null,
    explicit: !!item.explicit,
  }));

  return { tracks, total: data.tracks.total };
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
}

interface SpotifyDevicesResponse {
  devices: {
    id: string | null;
    name: string;
    type: string;
    is_active: boolean;
    is_restricted: boolean;
  }[];
}

const DEVICES_CACHE_MS = 20_000;
const devicesCache = new Map<string, { at: number; devices: SpotifyDevice[] }>();

/** The speaker list. Cached for a few seconds (several tabs and the player loop all ask for it);
 * pass `fresh` right after something that changes it. */
export async function listDevices(hostId: string, opts: { fresh?: boolean } = {}): Promise<SpotifyDevice[]> {
  const cached = devicesCache.get(hostId);
  if (!opts.fresh && cached && Date.now() - cached.at < DEVICES_CACHE_MS) return cached.devices;
  const devices = await dedupe(`devices:${hostId}`, () => fetchDevices(hostId));
  devicesCache.set(hostId, { at: Date.now(), devices });
  return devices;
}

async function fetchDevices(hostId: string): Promise<SpotifyDevice[]> {
  const res = await spotifyFetch(hostId, "/me/player/devices");
  if (!res.ok) {
    throw new Error(`Spotify devices fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as SpotifyDevicesResponse;
  return data.devices
    .filter((d): d is SpotifyDevicesResponse["devices"][number] & { id: string } => !!d.id)
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      isActive: d.is_active,
      isRestricted: d.is_restricted,
    }));
}

export async function transferPlayback(
  hostId: string,
  deviceId: string,
  play: boolean,
): Promise<void> {
  const res = await spotifyFetch(hostId, "/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
  devicesCache.delete(hostId); // the active speaker just changed
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify transfer failed: ${res.status} ${await res.text()}`);
  }
}

export interface SpotifyPlaybackState {
  deviceId: string | null;
  deviceName: string | null;
  isPlaying: boolean;
  trackUri: string | null;
  progressMs: number;
  durationMs: number;
  volumePercent: number | null;
}

interface SpotifyPlayerResponse {
  device: { id: string; name: string; volume_percent?: number | null } | null;
  is_playing: boolean;
  progress_ms: number | null;
  item: { uri: string; duration_ms: number } | null;
}

export function getPlaybackState(hostId: string): Promise<SpotifyPlaybackState | null> {
  return dedupe(`playback:${hostId}`, () => fetchPlaybackState(hostId));
}

async function fetchPlaybackState(hostId: string): Promise<SpotifyPlaybackState | null> {
  const res = await spotifyFetch(hostId, "/me/player");
  if (res.status === 204) return null;
  if (!res.ok) {
    throw new Error(`Spotify playback fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as SpotifyPlayerResponse;
  return {
    deviceId: data.device?.id ?? null,
    deviceName: data.device?.name ?? null,
    isPlaying: data.is_playing,
    trackUri: data.item?.uri ?? null,
    progressMs: data.progress_ms ?? 0,
    durationMs: data.item?.duration_ms ?? 0,
    volumePercent: typeof data.device?.volume_percent === "number" ? data.device.volume_percent : null,
  };
}

export async function getPlayerQueueUris(hostId: string): Promise<string[]> {
  const res = await spotifyFetch(hostId, "/me/player/queue");
  if (!res.ok) {
    throw new Error(`Spotify queue fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { queue?: { uri?: string }[] };
  return (data.queue ?? []).map((t) => t.uri).filter((u): u is string => !!u);
}

/** More tracks than this ahead of ours means someone has been queueing in Spotify directly: skipping
 * through them all would silently throw away their picks, so ask the host instead. */
export const MAX_PLAY_NOW_SKIPS = 5;

/** Ours sits behind more than MAX_PLAY_NOW_SKIPS tracks queued outside the app. */
export class SpotifyQueueBlockedError extends Error {
  constructor(public readonly foreignAhead: number) {
    super(`${foreignAhead} tracks queued outside ManyQueue are ahead of ours`);
  }
}

/** Every call worked but a different song is playing afterwards. */
export class SpotifyPlayUnconfirmedError extends Error {
  constructor(public readonly playing: string | null) {
    super(`asked Spotify for a song, but ${playing ?? "nothing"} is playing`);
  }
}

const IN_TESTS = process.env.NODE_ENV === "test";
/** Gaps between "is ours playing yet?" checks: Spotify's state can trail a skip by a second or so. */
const CONFIRM_DELAYS_MS = IN_TESTS ? [0, 0, 0] : [600, 800, 1000];
/** Gaps between reads of the queue listing after adding to it. Live, the add answered 200 and the
 * listing only showed the song a few seconds later (2026-11-04). */
const LISTING_DELAYS_MS = IN_TESTS ? [0, 0, 0, 0] : [0, 700, 1000, 1500];

/** Spotify accepted the add, but the song never showed up in the queue listing. */
export class SpotifyQueueNotListedError extends Error {
  constructor() {
    super("Spotify accepted the queue add but never listed the song");
  }
}

/**
 * Plays `uri` now, without trusting any single call:
 *  1. add it to Spotify's queue (unless the handoff already did: `alreadyQueued`);
 *  2. read the queue once and count the tracks ahead of it;
 *  3. skip exactly that many plus one;
 *  4. check ours is the one playing.
 *
 * Not PUT /me/player/play {uris}: desktop Spotify (seen 2026-11-04 on a Windows PC, and the same shape
 * on an iPhone earlier that night) answers 204 to that and then drops to "paused, nothing loaded",
 * which the room saw as the speaker disconnecting. Queue + next worked every time. Starting the song's
 * album at that song (playFromAlbum) is the fallback for a device that refuses the queue or the skip
 * (nothing loaded at all), and for a queue too cluttered to skip through, after which the caller warns
 * the host. The queue listing trails the add by a few
 * seconds, so it's read a few times before giving up.
 *
 * Never loops: a wrong song after step 4 is reported, not chased. The player loop already spots a song
 * that isn't ours and redirects on its next poll, so chasing here would only fight it.
 */
export async function playTrackOnDevice(
  hostId: string,
  deviceId: string,
  uri: string,
  opts: { alreadyQueued?: boolean } = {},
): Promise<string> {
  if (!opts.alreadyQueued) {
    const params = new URLSearchParams({ uri, device_id: deviceId });
    const queued = await spotifyFetch(hostId, `/me/player/queue?${params.toString()}`, { method: "POST" });
    if (!queued.ok && queued.status !== 204) return playFromAlbum(hostId, deviceId, uri);
  }

  // No fallback play when it's missing: the device took the add, so the queue route is working there.
  // The player loop's own retry comes round again instead.
  let skips: number | null = null;
  for (const delay of LISTING_DELAYS_MS) {
    await new Promise((r) => setTimeout(r, delay));
    const listing = await getPlayerQueueUris(hostId).catch(() => null);
    skips = listing ? skipsToReach(listing, uri) : null;
    if (skips !== null) break;
  }
  if (skips === null) throw new SpotifyQueueNotListedError();
  if (skips > MAX_PLAY_NOW_SKIPS + 1) {
    await playFromAlbum(hostId, deviceId, uri);
    throw new SpotifyQueueBlockedError(skips - 1);
  }

  for (let i = 0; i < skips; i++) {
    const skipped = await spotifyFetch(hostId, `/me/player/next?device_id=${deviceId}`, { method: "POST" });
    if (!skipped.ok && skipped.status !== 204) return playFromAlbum(hostId, deviceId, uri);
  }

  return confirmPlaying(hostId, uri);
}

/**
 * Waits for `uri` to be the one playing and returns the id Spotify reports for it. Track relinking
 * means the same song can come back under another id (an album's copy vs a playlist's), so a different
 * id with the same name and length counts as ours: the caller then expects that id instead of taking
 * its own song for a stranger's and redirecting away from it.
 */
async function confirmPlaying(hostId: string, uri: string): Promise<string> {
  let playing: string | null = null;
  for (const delay of CONFIRM_DELAYS_MS) {
    await new Promise((r) => setTimeout(r, delay));
    playing = (await fetchPlaybackState(hostId).catch(() => null))?.trackUri ?? null;
    if (playing === uri) return uri;
    if (playing && (await sameSong(hostId, playing, uri))) return playing;
  }
  throw new SpotifyPlayUnconfirmedError(playing);
}

const trackFacts = new Map<string, { name: string; durationMs: number; albumUri: string | null } | null>();
async function factsOf(hostId: string, uri: string) {
  if (trackFacts.has(uri)) return trackFacts.get(uri)!;
  const id = uri.split(":").pop();
  const res = id ? await spotifyFetch(hostId, `/tracks/${id}`).catch(() => null) : null;
  const data = res?.ok ? ((await res.json()) as { name?: string; duration_ms?: number; album?: { uri?: string } }) : null;
  const facts = data?.name ? { name: data.name, durationMs: data.duration_ms ?? 0, albumUri: data.album?.uri ?? null } : null;
  if (trackFacts.size > 2000) trackFacts.clear();
  if (facts) trackFacts.set(uri, facts); // a failed lookup is retried next time
  return facts;
}

async function sameSong(hostId: string, a: string, b: string): Promise<boolean> {
  const [fa, fb] = await Promise.all([factsOf(hostId, a), factsOf(hostId, b)]);
  return !!fa && !!fb && fa.name.toLowerCase() === fb.name.toLowerCase() && Math.abs(fa.durationMs - fb.durationMs) < 2_000;
}

/**
 * The fallback when the device refuses queue/next: start the song's album at that song. Not PUT play
 * {uris}: on desktop Spotify that answers 204 and leaves the player empty, even with the song queued
 * first (tested 2026-11-05), while album + offset started at once, even on a player knocked out that
 * way (the workaround from github.com/spotify/web-api/issues/631). {uris} stays only for a track whose
 * album can't be looked up.
 */
async function playFromAlbum(hostId: string, deviceId: string, uri: string): Promise<string> {
  const albumUri = (await factsOf(hostId, uri))?.albumUri;
  const res = await spotifyFetch(hostId, `/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify(albumUri ? { context_uri: albumUri, offset: { uri } } : { uris: [uri] }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify play failed: ${res.status} ${await res.text()}`);
  }
  return confirmPlaying(hostId, uri);
}

export async function queueTrackOnDevice(
  hostId: string,
  deviceId: string,
  uri: string,
): Promise<void> {
  const params = new URLSearchParams({ uri, device_id: deviceId });
  const res = await spotifyFetch(hostId, `/me/player/queue?${params.toString()}`, {
    method: "POST",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify queue failed: ${res.status} ${await res.text()}`);
  }
}

export async function skipToNext(hostId: string, deviceId: string): Promise<void> {
  const res = await spotifyFetch(hostId, `/me/player/next?device_id=${deviceId}`, {
    method: "POST",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify skip failed: ${res.status} ${await res.text()}`);
  }
}

interface SpotifyPlaylistItem {
  is_local: boolean;
  item: SpotifyTrackItem | null;
}

interface SpotifyPlaylistItemsResponse {
  items: SpotifyPlaylistItem[];
}

export async function getPlaylistTracks(hostId: string, playlistId: string): Promise<SearchTrack[]> {
  // First 100 tracks only — plenty for a fallback pool on a one-night build.
  // Spotify renamed GET /playlists/{id}/tracks to /items in its Feb 2026 migration
  // (old endpoint now 403s); the per-row field was renamed from `track` to `item` too.
  const res = await spotifyFetch(hostId, `/playlists/${playlistId}/items?limit=100`);
  if (!res.ok) {
    throw new Error(`Spotify playlist items fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as SpotifyPlaylistItemsResponse;
  return data.items
    .filter((row): row is SpotifyPlaylistItem & { item: SpotifyTrackItem } => !row.is_local && !!row.item)
    .map((row) => ({
      uri: row.item.uri,
      name: row.item.name,
      artistName: row.item.artists.map((a) => a.name).join(", "),
      albumArtUrl: row.item.album.images[0]?.url ?? null,
      durationMs: row.item.duration_ms,
      releaseYear: row.item.album.release_date
        ? Number(row.item.album.release_date.slice(0, 4))
        : null,
      explicit: !!row.item.explicit,
    }));
}

export interface CreatedPlaylist {
  id: string;
  url: string;
}

export async function createPlaylist(
  hostId: string,
  name: string,
  description = "Made with ManyQueue",
): Promise<CreatedPlaylist> {
  // POST /users/{id}/playlists was removed in Spotify's Feb 2026 API migration —
  // /me/playlists is the replacement (confirmed via Block 10's endpoint hunt).
  const res = await spotifyFetch(hostId, "/me/playlists", {
    method: "POST",
    body: JSON.stringify({ name, public: false, description }),
  });
  if (!res.ok) {
    throw new Error(`Spotify playlist create failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string; external_urls: { spotify: string } };
  return { id: data.id, url: data.external_urls.spotify };
}

export async function addTracksToPlaylist(
  hostId: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const res = await spotifyFetch(hostId, `/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: batch }),
    });
    if (!res.ok) {
      throw new Error(`Spotify add tracks failed: ${res.status} ${await res.text()}`);
    }
  }
}

export async function pausePlayback(hostId: string, deviceId: string): Promise<void> {
  const res = await spotifyFetch(hostId, `/me/player/pause?device_id=${deviceId}`, {
    method: "PUT",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify pause failed: ${res.status} ${await res.text()}`);
  }
}

export async function resumePlayback(hostId: string, deviceId: string): Promise<void> {
  // No body — resumes from the current position rather than starting a specific track.
  const res = await spotifyFetch(hostId, `/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify resume failed: ${res.status} ${await res.text()}`);
  }
}

/** Sets the device volume (0-100). Some devices don't allow remote volume
 * control; Spotify answers 403 then, which the caller reports. */
export async function setPlaybackVolume(hostId: string, deviceId: string, percent: number): Promise<void> {
  const res = await spotifyFetch(hostId, `/me/player/volume?volume_percent=${Math.round(percent)}&device_id=${deviceId}`, {
    method: "PUT",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify volume failed: ${res.status} ${await res.text()}`);
  }
}
