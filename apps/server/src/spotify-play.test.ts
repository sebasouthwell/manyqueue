import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db/hosts.js", () => ({
  getHostById: () => ({ id: "h1" }),
  getDecryptedRefreshToken: (_host: unknown, slot: string) => (slot === "backup" ? null : "refresh-p"),
  updateRefreshToken: () => {},
}));

import {
  playTrackOnDevice,
  resetSpotifyLimiterForTests,
  SpotifyQueueBlockedError,
  SpotifyPlayUnconfirmedError,
  SpotifyQueueNotListedError,
  MAX_PLAY_NOW_SKIPS,
} from "./spotify.js";

process.env.SPOTIFY_CLIENT_ID = "id";
process.env.SPOTIFY_CLIENT_SECRET = "secret";
process.env.BACKUP_CLIENT_ID = "";
process.env.BACKUP_SECRET_ID = "";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

/** A tiny Spotify player: a current song and a queue, driven by the same calls the app makes. */
let player: { current: string | null; queue: string[]; refuse: Set<string>; nextGoesTo?: string; listingLag: number; dropAdds?: boolean; desktop?: boolean; relinkTo?: string };
let playBodies: { uris?: string[]; context_uri?: string; offset?: { uri: string } }[];
let calls: string[];

beforeEach(() => {
  resetSpotifyLimiterForTests();
  player = { current: "spotify:track:now", queue: [], refuse: new Set(), listingLag: 0 };
  calls = [];
  playBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/token")) return json({ access_token: "tok", token_type: "Bearer", scope: "", expires_in: 3600 });
      const method = init?.method ?? "GET";
      const path = url.replace("https://api.spotify.com/v1", "").split("?")[0];
      const key = `${method} ${path}`;
      calls.push(key);
      if (player.refuse.has(key)) return json({ error: { status: 403 } }, { status: 403 });
      if (key === "POST /me/player/queue") {
        if (!player.dropAdds) player.queue.push(new URL(url).searchParams.get("uri")!);
        return new Response(null, { status: 204 });
      }
      if (key === "GET /me/player/queue" && player.listingLag > 0) {
        player.listingLag--;
        return json({ currently_playing: { uri: player.current }, queue: player.queue.slice(0, -1).map((uri) => ({ uri })) });
      }
      if (key === "GET /me/player/queue") return json({ currently_playing: { uri: player.current }, queue: player.queue.map((uri) => ({ uri })) });
      if (key === "POST /me/player/next") {
        player.current = player.nextGoesTo ?? player.queue.shift() ?? null;
        return new Response(null, { status: 204 });
      }
      if (key === "PUT /me/player/play") {
        const body = JSON.parse(String(init?.body)) as { uris?: string[]; context_uri?: string; offset?: { uri: string } };
        playBodies.push(body);
        // Desktop Spotify: a bare {uris} play is accepted and leaves the player empty.
        player.current = body.context_uri ? (player.relinkTo ?? body.offset!.uri) : player.desktop ? null : body.uris![0];
        player.queue = [];
        return new Response(null, { status: 204 });
      }
      if (method === "GET" && path.startsWith("/tracks/")) {
        const id = path.split("/").pop()!;
        // A relinked copy has a different id but the same name and length.
        const name = id === "relinked" || id === "ours" ? "Our Song" : id;
        return json({ name, duration_ms: 9_000, album: { uri: "spotify:album:alb" } });
      }
      if (key === "GET /me/player") {
        return player.current
          ? json({ device: { id: "pc", name: "PC" }, is_playing: true, progress_ms: 0, item: { uri: player.current, duration_ms: 1000 } })
          : new Response(null, { status: 204 });
      }
      return json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const OURS = "spotify:track:ours";
const playCalls = () => calls.filter((c) => c === "PUT /me/player/play").length;
const nexts = () => calls.filter((c) => c === "POST /me/player/next").length;

describe("playTrackOnDevice — play now without trusting any one call", () => {
  it("normal case: queue it, one skip, confirmed — never PUT play", async () => {
    await playTrackOnDevice("h1", "pc", OURS);
    expect(player.current).toBe(OURS);
    expect(nexts()).toBe(1);
    expect(playCalls()).toBe(0);
  });

  it("skips exactly past what's queued ahead, and no further", async () => {
    player.queue = ["spotify:track:x", "spotify:track:y"];
    await playTrackOnDevice("h1", "pc", OURS);
    expect(player.current).toBe(OURS);
    expect(nexts()).toBe(3);
  });

  it("a song the handoff already queued is only skipped to, not queued twice", async () => {
    player.queue = [OURS];
    await playTrackOnDevice("h1", "pc", OURS, { alreadyQueued: true });
    expect(calls).not.toContain("POST /me/player/queue");
    expect(player.current).toBe(OURS);
    expect(player.queue).toEqual([]);
  });

  it("too much queued outside the app: doesn't burn through it, tells the caller", async () => {
    player.queue = Array.from({ length: MAX_PLAY_NOW_SKIPS + 2 }, (_, i) => `spotify:track:f${i}`);
    const err = await playTrackOnDevice("h1", "pc", OURS).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyQueueBlockedError);
    expect((err as SpotifyQueueBlockedError).foreignAhead).toBe(MAX_PLAY_NOW_SKIPS + 2);
    expect(nexts()).toBe(0);
  });

  it("a device that refuses the queue (nothing loaded) gets the song's album started at the song, not {uris}", async () => {
    player.refuse.add("POST /me/player/queue");
    player.desktop = true;
    await expect(playTrackOnDevice("h1", "pc", OURS)).resolves.toBe(OURS);
    expect(playBodies).toEqual([{ context_uri: "spotify:album:alb", offset: { uri: OURS } }]);
    expect(player.current).toBe(OURS);
  });

  it("the same song under a relinked id counts as ours, and its id comes back for the room to expect", async () => {
    player.nextGoesTo = "spotify:track:relinked";
    await expect(playTrackOnDevice("h1", "pc", OURS)).resolves.toBe("spotify:track:relinked");
  });

  it("a device that refuses the skip falls back to PUT play", async () => {
    player.refuse.add("POST /me/player/next");
    await playTrackOnDevice("h1", "pc", OURS);
    expect(playCalls()).toBe(1);
  });

  it("wrong song afterwards: reported once, not chased with more skips or PUT play", async () => {
    player.nextGoesTo = "spotify:track:somethingelse";
    const err = await playTrackOnDevice("h1", "pc", OURS).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyPlayUnconfirmedError);
    expect(nexts()).toBe(1);
    expect(playCalls()).toBe(0);
  });

  it("the queue listing lags the add (seen live): reads again instead of giving up", async () => {
    player.listingLag = 2;
    await playTrackOnDevice("h1", "pc", OURS);
    expect(calls.filter((c) => c === "GET /me/player/queue")).toHaveLength(3);
    expect(player.current).toBe(OURS);
    expect(playCalls()).toBe(0);
  });

  it("never listed at all: reported, and no PUT play (that's what knocks desktop Spotify out)", async () => {
    player.dropAdds = true;
    const err = await playTrackOnDevice("h1", "pc", OURS).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyQueueNotListedError);
    expect(playCalls()).toBe(0);
    expect(nexts()).toBe(0);
  });
});
