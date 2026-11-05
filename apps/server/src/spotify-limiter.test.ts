import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let hasBackupLogin = true;
vi.mock("./db/hosts.js", () => ({
  getHostById: () => ({ id: "h1" }),
  getDecryptedRefreshToken: (_host: unknown, slot: string) => (slot === "backup" ? (hasBackupLogin ? "refresh-b" : null) : "refresh-p"),
  updateRefreshToken: () => {},
}));

import {
  getPlaybackState,
  listDevices,
  searchTracks,
  getSpotifyBlockedUntil,
  getSpotifyStatus,
  initSpotifyCredentials,
  SpotifyQuotaError,
  resetSpotifyLimiterForTests,
} from "./spotify.js";

process.env.SPOTIFY_CLIENT_ID = "id";
process.env.SPOTIFY_CLIENT_SECRET = "secret";
process.env.BACKUP_CLIENT_ID = "";
process.env.BACKUP_SECRET_ID = "";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

let calls: string[];
let handler: (url: string) => Response;

beforeEach(() => {
  resetSpotifyLimiterForTests();
  process.env.BACKUP_CLIENT_ID = "";
  process.env.BACKUP_SECRET_ID = "";
  hasBackupLogin = true;
  calls = [];
  handler = () => json({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.includes("/api/token")) {
        const isBackup = Buffer.from(headers.Authorization!.replace("Basic ", ""), "base64").toString().startsWith("bid:");
        return json({ access_token: isBackup ? "tok-backup" : "tok", token_type: "Bearer", scope: "", expires_in: 3600 });
      }
      calls.push(`${headers.Authorization === "Bearer tok-backup" ? "[backup] " : ""}${url.replace("https://api.spotify.com/v1", "")}`);
      return handler(url);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("spotify limiter", () => {
  it("a long 429 on a player endpoint blocks only the player group", async () => {
    handler = (url) =>
      url.includes("/me/player")
        ? json({ error: { reason: "QUOTA_EXCEEDED" } }, { status: 429, headers: { "Retry-After": "17000" } })
        : json({ tracks: { items: [], total: 0 } });

    await expect(getPlaybackState("h1")).rejects.toBeInstanceOf(SpotifyQuotaError);
    expect(getSpotifyBlockedUntil()).not.toBeNull();

    // Fails fast without another network call...
    const before = calls.length;
    await expect(getPlaybackState("h1")).rejects.toBeInstanceOf(SpotifyQuotaError);
    expect(calls.length).toBe(before);

    // ...while search still goes through.
    await expect(searchTracks("h1", "abba", 0)).resolves.toEqual({ tracks: [], total: 0 });
  });

  it("shares one call between simultaneous playback polls", async () => {
    handler = () => new Response(null, { status: 204 });
    await Promise.all([getPlaybackState("h1"), getPlaybackState("h1"), getPlaybackState("h1")]);
    expect(calls.filter((c) => c === "/me/player")).toHaveLength(1);
  });

  it("caches the speaker list, and fresh bypasses the cache", async () => {
    handler = () => json({ devices: [{ id: "d1", name: "Kitchen", type: "Speaker", is_active: true, is_restricted: false }] });
    await listDevices("h1");
    await listDevices("h1");
    expect(calls.filter((c) => c.startsWith("/me/player/devices"))).toHaveLength(1);
    await listDevices("h1", { fresh: true });
    expect(calls.filter((c) => c.startsWith("/me/player/devices"))).toHaveLength(2);
  });

  it("refuses reads past the local budget without touching Spotify or blocking", async () => {
    handler = () => new Response(null, { status: 204 });
    let refused: SpotifyQuotaError | null = null;
    for (let i = 0; i < 60 && !refused; i++) {
      try {
        await getPlaybackState("h1");
      } catch (err) {
        if (err instanceof SpotifyQuotaError) refused = err;
      }
    }
    expect(refused?.local).toBe(true);
    expect(calls.length).toBe(40);
    expect(getSpotifyBlockedUntil()).toBeNull();
  });

  describe("with a backup app", () => {
    beforeEach(() => {
      process.env.BACKUP_CLIENT_ID = "bid";
      process.env.BACKUP_SECRET_ID = "bsecret";
    });

    const limitedPrimary = (url: string, init?: never) => url && url; // placeholder to keep types simple

    it("falls over to the backup when the primary is rate-limited, and status stays unblocked", async () => {
      const seen: string[] = [];
      handler = () => new Response(null, { status: 204 });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL, init?: RequestInit) => {
          const url = String(input);
          const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization ?? "";
          if (url.includes("/api/token")) {
            const backup = Buffer.from(auth.replace("Basic ", ""), "base64").toString().startsWith("bid:");
            return json({ access_token: backup ? "tok-backup" : "tok-primary", token_type: "Bearer", scope: "", expires_in: 3600 });
          }
          seen.push(auth);
          return auth === "Bearer tok-primary"
            ? json({ error: { reason: "QUOTA_EXCEEDED" } }, { status: 429, headers: { "Retry-After": "17000" } })
            : new Response(null, { status: 204 });
        }),
      );
      void limitedPrimary;

      await expect(getPlaybackState("h1")).resolves.toBeNull();
      expect(seen).toEqual(["Bearer tok-primary", "Bearer tok-backup"]);
      expect(getSpotifyBlockedUntil()).toBeNull();
      expect(getSpotifyStatus().authFailed).toBe(false);

      // Next call skips the limited primary entirely.
      seen.length = 0;
      await getPlaybackState("h1");
      expect(seen).toEqual(["Bearer tok-backup"]);
    });

    it("uses the backup only until the primary's return time, then goes back to the primary", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-09-26T13:00:00Z"));
        const seen: string[] = [];
        let primaryLimited = true;
        vi.stubGlobal(
          "fetch",
          vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = String(input);
            const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization ?? "";
            if (url.includes("/api/token")) {
              const backup = Buffer.from(auth.replace("Basic ", ""), "base64").toString().startsWith("bid:");
              return json({ access_token: backup ? "tok-backup" : "tok-primary", token_type: "Bearer", scope: "", expires_in: 36000 });
            }
            seen.push(auth === "Bearer tok-backup" ? "backup" : "primary");
            return auth === "Bearer tok-primary" && primaryLimited
              ? json({ error: { reason: "QUOTA_EXCEEDED" } }, { status: 429, headers: { "Retry-After": "3600" } })
              : new Response(null, { status: 204 });
          }),
        );

        await getPlaybackState("h1"); // primary says no (for an hour), backup answers
        await getPlaybackState("h1");
        expect(seen).toEqual(["primary", "backup", "backup"]);

        vi.setSystemTime(new Date("2026-09-26T14:00:01Z")); // past the primary's return time
        primaryLimited = false;
        seen.length = 0;
        await getPlaybackState("h1");
        await getPlaybackState("h1");
        expect(seen).toEqual(["primary", "primary"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports blocked only once BOTH apps are limited", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) =>
          String(input).includes("/api/token")
            ? json({ access_token: "t", token_type: "Bearer", scope: "", expires_in: 3600 })
            : json({ error: { reason: "QUOTA_EXCEEDED" } }, { status: 429, headers: { "Retry-After": "600" } }),
        ),
      );
      await expect(getPlaybackState("h1")).rejects.toBeInstanceOf(SpotifyQuotaError);
      expect(getSpotifyBlockedUntil()).not.toBeNull();
    });

    it("asks the host to log in through the backup when it has no login there", async () => {
      hasBackupLogin = false;
      initSpotifyCredentials(false);
      expect(getSpotifyStatus().backupNeedsLogin).toBe(true);
      handler = () => new Response(null, { status: 204 });
      await getPlaybackState("h1"); // still works through the primary
      expect(calls).toEqual(["/me/player"]);
    });
  });
});
