import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "../db/test-helpers.js";
import { guests, queueItems } from "../db/schema.js";
import { addQueueItem } from "../db/queue.js";
import { recordReaction } from "../db/reactions.js";
import { getAiUsage } from "../db/ai-nicknames.js";
import { getCachedGenres } from "../db/genres.js";
import { buildTasteProfiles, artistsForTasting } from "../db/taste.js";
import { generateNicknames } from "./nicknames.js";
import { setAiLogger } from "./deepseek.js";
import { ensureGenres } from "./genres.js";
import type { DB } from "../db/client.js";

// A fake DeepSeek: records every request and answers from `reply`.
let server: http.Server;
let requests: { system: string; user: string }[] = [];
let reply: (body: { system: string; user: string }) => unknown = () => ({});
let status = 200;

beforeAll(async () => {
  setAiLogger({ info: () => {}, warn: () => {} });
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      const parsed = { system: body.messages[0].content as string, user: body.messages[1].content as string };
      requests.push(parsed);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(parsed)) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
  status = 200;
  process.env.DEEPSEEK_API_KEY = "test-key";
});

function addGuest(db: DB, id: string, nickname: string) {
  db.insert(guests).values({ id, roomId: "room-1", nickname, emoji: "🐸", role: "guest", lastSeenAt: new Date(), createdAt: new Date() }).run();
}
function songs(db: DB, guestId: string, n: number, artist: string, prefix = guestId) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const item = addQueueItem({ roomId: "room-1", trackUri: `spotify:track:${prefix}${i}`, trackName: `Track ${prefix.replace("guest-", "")}-${i}`, artistName: artist, albumArtUrl: null, durationMs: 1000, addedBy: guestId }, db);
    out.push(item);
  }
  return out;
}
function room() {
  const db = createTestDb();
  seedRoomWithGuest(db); // guest-1 "Maya"
  addGuest(db, "guest-2", "Sam");
  addGuest(db, "guest-3", "Jo");
  return db;
}

describe("taste profiles", () => {
  it("leave out guests with too few songs and unrevealed mystery picks", () => {
    const db = room();
    songs(db, "guest-1", 3, "Bad Bunny");
    songs(db, "guest-2", 2, "Dua Lipa");
    const hidden = songs(db, "guest-3", 3, "Secret Artist");
    for (const h of hidden) db.update(queueItems).set({ anonymous: true }).where(eq(queueItems.id, h.id)).run();

    const profiles = buildTasteProfiles("room-1", new Map(), 3, db);
    expect(profiles.map((p) => p.guestId)).toEqual(["guest-1"]);
    expect(artistsForTasting("room-1", db).has("secret artist")).toBe(false);
  });

  it("carries reactions, outcomes and the top genre", () => {
    const db = room();
    const [a, b, c] = songs(db, "guest-1", 3, "Bad Bunny");
    recordReaction(a!.id, "guest-2", "🔥", db);
    recordReaction(a!.id, "guest-3", "🔥", db);
    db.update(queueItems).set({ status: "played", startedAt: new Date() }).where(eq(queueItems.id, a!.id)).run();
    db.update(queueItems).set({ status: "skipped", startedAt: new Date() }).where(eq(queueItems.id, b!.id)).run();
    void c;
    const [p] = buildTasteProfiles("room-1", new Map([["bad bunny", ["reggaeton", "latin trap"]]]), 3, db);
    expect(p!.totals).toMatchObject({ songsAdded: 3, skipRate: 0.5, topGenre: "reggaeton" });
    expect(p!.songs.find((s) => s.outcome === "played")!.reactions).toEqual({ "🔥": 2 });
    expect(p!.songs.some((s) => s.outcome === "skipped")).toBe(true);
  });

  it("reads a near-end skip as played, not skipped — it still counts as finished, just not against the skip rate", () => {
    const db = room();
    const [early, late] = songs(db, "guest-1", 3, "Bad Bunny");
    db.update(queueItems).set({ status: "skipped", startedAt: new Date(), nearEndSkip: false }).where(eq(queueItems.id, early!.id)).run();
    db.update(queueItems).set({ status: "skipped", startedAt: new Date(), nearEndSkip: true }).where(eq(queueItems.id, late!.id)).run();
    const [p] = buildTasteProfiles("room-1", new Map(), 3, db);
    expect(p!.songs.find((s) => s.title === early!.trackName)!.outcome).toBe("skipped");
    expect(p!.songs.find((s) => s.title === late!.trackName)!.outcome).toBe("played");
    expect(p!.totals.skipRate).toBeCloseTo(0.5); // early(skipped) + late(played) = 2 finished; only the early one counts as a skip
  });
});

describe("genre tagging", () => {
  it("asks once for untagged artists, caches the answer, and never asks again", async () => {
    const db = room();
    reply = () => ({ a1: ["Reggaeton", "Latin Trap"], a2: [] });
    const artists = new Map([["bad bunny", "Bad Bunny"], ["nobody", "Nobody"]]);
    const first = await ensureGenres("room-1", artists, db);
    expect(first.get("bad bunny")).toEqual(["reggaeton", "latin trap"]);
    expect(requests).toHaveLength(1);
    expect(getCachedGenres(["bad bunny"], new Date(), db).get("bad bunny")).toEqual(["reggaeton", "latin trap"]);

    await ensureGenres("room-1", new Map([["bad bunny", "Bad Bunny"]]), db); // cached: no call
    expect(requests).toHaveLength(1);
    expect(getAiUsage("room-1", db).genreCalls).toBe(1);
  });

  it("quietly returns nothing new when the AI fails", async () => {
    const db = room();
    status = 400;
    const out = await ensureGenres("room-1", new Map([["x", "X"]]), db);
    expect(out.size).toBe(0);
  });
});

describe("generateNicknames", () => {
  it("makes ONE call for the whole room, anonymised, and keeps only replies that pass the checks", async () => {
    const db = room();
    songs(db, "guest-1", 3, "Bad Bunny");
    songs(db, "guest-2", 4, "Dua Lipa");
    songs(db, "guest-3", 1, "Someone"); // too few: left out
    reply = (body) => {
      if (body.system.includes("tag music artists")) return { a1: ["reggaeton"], a2: ["pop"] };
      return {
        g1: { nickname: "The Reggaeton Menace 🐰", why: "Three reggaeton tracks in a row." },
        g2: { nickname: "Pop Machine", why: "no emoji so this is dropped" },
        g9: { nickname: "Ghost 👻", why: "an id we never sent" },
      };
    };

    const result = await generateNicknames("room-1", {}, db);
    expect(result).toEqual({ ok: true, proposals: [{ guestId: "guest-1", nickname: "The Reggaeton Menace 🐰", why: "Three reggaeton tracks in a row." }], rejected: 2 }); // g2 fails the emoji check, g9 was never sent

    const nicknameCalls = requests.filter((r) => r.system.includes("nickname"));
    expect(nicknameCalls).toHaveLength(1);
    const sent = nicknameCalls[0]!.user;
    for (const secret of ["Maya", "Sam", "Jo", "Test Room", "guest-1", "guest-2"]) expect(sent, secret).not.toContain(secret);
    expect(Object.keys(JSON.parse(sent).guests)).toEqual(["g1", "g2"]);
    expect(getAiUsage("room-1", db).nicknameCalls).toBe(1);
  });

  it("keeps a wrongly-keyed reply when there is only one guest, and counts it as rejected when there are several", async () => {
    const db = room();
    songs(db, "guest-1", 3, "Bad Bunny");
    reply = (body) => (body.system.includes("tag music artists") ? {} : { g7: { nickname: "Skipped King 👑", why: "Tried three songs." } });
    expect(await generateNicknames("room-1", {}, db)).toEqual({ ok: true, proposals: [{ guestId: "guest-1", nickname: "Skipped King 👑", why: "Tried three songs." }], rejected: 0 });

    songs(db, "guest-2", 3, "Dua Lipa");
    const many = await generateNicknames("room-1", {}, db);
    expect(many).toEqual({ ok: true, proposals: [], rejected: 1 });
  });

  it("gives the model the exact ids and no example id to copy", async () => {
    const db = room();
    songs(db, "guest-1", 3, "Bad Bunny");
    reply = (body) => (body.system.includes("tag music artists") ? {} : { g1: { nickname: "Fine Name 🎵", why: "x" } });
    await generateNicknames("room-1", {}, db);
    const call = requests.find((r) => r.system.includes("nickname"))!;
    expect(call.system).not.toContain("g7");
    expect(JSON.parse(call.user).guestIds).toEqual(["g1"]);
  });

  it("rejects a nickname that contains a guest's real name", async () => {
    const db = room();
    songs(db, "guest-1", 3, "Bad Bunny");
    reply = (body) => (body.system.includes("tag music artists") ? {} : { g1: { nickname: "Maya's Mix 🎶", why: "Queued three songs." } });
    const result = await generateNicknames("room-1", {}, db);
    expect(result).toEqual({ ok: true, proposals: [], rejected: 1 });
  });

  it("stops at the nightly budget and when there is no key", async () => {
    const db = room();
    songs(db, "guest-1", 3, "Bad Bunny");
    reply = (body) => (body.system.includes("tag music artists") ? {} : { g1: { nickname: "Same Same 🎵", why: "x" } });
    for (let i = 0; i < 10; i++) expect((await generateNicknames("room-1", {}, db)).ok).toBe(true);
    expect(await generateNicknames("room-1", {}, db)).toEqual({ ok: false, reason: "budget" });

    delete process.env.DEEPSEEK_API_KEY;
    expect(await generateNicknames("room-1", {}, createTestDb())).toEqual({ ok: false, reason: "not_configured" });
  });

  it("reports an unusable reply without throwing", async () => {
    const db = room();
    songs(db, "guest-1", 3, "Bad Bunny");
    reply = (body) => (body.system.includes("tag music artists") ? {} : ["not", "an", "object"]);
    expect(await generateNicknames("room-1", {}, db)).toEqual({ ok: false, reason: "bad_reply" });
  });
});
