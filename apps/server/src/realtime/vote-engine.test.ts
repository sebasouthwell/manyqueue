import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoteCountsPayload, VoteResult } from "@manyqueue/shared";
import { createTestDb, seedRoomWithGuest } from "../db/test-helpers.js";
import { guests } from "../db/schema.js";
import { getVoteById, type Vote } from "../db/votes.js";
import { createVoteEngine, type VoteEngineHooks } from "./vote-engine.js";
import type { DB } from "../db/client.js";

function addGuests(db: DB, n: number) {
  for (let i = 2; i <= n; i++) {
    db.insert(guests)
      .values({
        id: `guest-${i}`,
        roomId: "room-1",
        nickname: `G${i}`,
        emoji: "🎉",
        role: "guest",
        lastSeenAt: new Date(),
        createdAt: new Date(),
      })
      .run();
  }
}

function harness(db: DB, activeCount = () => 10) {
  const log = { opened: [] as Vote[], tallies: [] as VoteCountsPayload[], closed: [] as { vote: Vote; result: VoteResult }[] };
  const hooks: VoteEngineHooks = {
    activeCount,
    onOpened: (v) => log.opened.push(v),
    onTally: (_v, c) => log.tallies.push(c),
    onClosed: (vote, result) => log.closed.push({ vote, result }),
  };
  return { engine: createVoteEngine(hooks, db), log };
}

const contest = {
  roomId: "room-1",
  type: "contest" as const,
  title: "Which plays next?",
  options: [
    { id: "first", label: "A" },
    { id: "second", label: "B" },
  ],
  durationMs: 30_000,
};

describe("vote engine", () => {
  let db: DB;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T20:00:00Z"));
    db = createTestDb();
    seedRoomWithGuest(db);
    addGuests(db, 6);
  });
  afterEach(() => vi.useRealTimers());

  it("closes at the deadline with a result and announces it once", () => {
    const { engine, log } = harness(db);
    const vote = engine.open(contest);
    engine.cast(vote.id, "guest-1", "second");
    engine.cast(vote.id, "guest-2", "second");
    engine.cast(vote.id, "guest-3", "first");

    vi.advanceTimersByTime(29_999);
    expect(log.closed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(log.closed).toHaveLength(1);
    expect(log.closed[0].result).toMatchObject({ winnerOptionId: "second", outcome: "winner" });
    expect(getVoteById(vote.id, db)).toMatchObject({ status: "closed", result: { winnerOptionId: "second" } });

    vi.advanceTimersByTime(60_000);
    expect(log.closed).toHaveLength(1);
    expect(engine.cast(vote.id, "guest-4", "first")).toMatchObject({ ok: false, error: "vote_closed" });
  });

  it("ballots can be changed until the deadline", () => {
    const { engine, log } = harness(db);
    const vote = engine.open(contest);
    engine.cast(vote.id, "guest-1", "first");
    engine.cast(vote.id, "guest-1", "second");
    vi.advanceTimersByTime(30_000);
    expect(log.closed[0].result.counts).toEqual({ first: 0, second: 1 });
  });

  it("a guess vote's first choice is final", () => {
    const { engine, log } = harness(db);
    const vote = engine.open({ ...contest, type: "guess" });
    expect(engine.cast(vote.id, "guest-1", "first")).toMatchObject({ ok: true });
    expect(engine.cast(vote.id, "guest-1", "second")).toMatchObject({ ok: false, error: "already_voted" });
    vi.advanceTimersByTime(30_000);
    expect(log.closed[0].result.counts).toEqual({ first: 1, second: 0 });
  });

  it("rejects unknown options, unknown guests and missing votes", () => {
    const { engine } = harness(db);
    const vote = engine.open(contest);
    expect(engine.cast(vote.id, "guest-1", "nope")).toMatchObject({ error: "invalid_option" });
    expect(engine.cast(vote.id, "stranger", "first")).toMatchObject({ error: "not_in_room" });
    expect(engine.cast("missing", "guest-1", "first")).toMatchObject({ error: "vote_not_found" });
  });

  it("no votes: the first entry wins", () => {
    const { engine, log } = harness(db);
    engine.open(contest);
    vi.advanceTimersByTime(30_000);
    expect(log.closed[0].result).toMatchObject({ winnerOptionId: "first", outcome: "no_votes" });
  });

  it("a tie goes to the option entered first", () => {
    const { engine, log } = harness(db);
    const vote = engine.open(contest);
    engine.cast(vote.id, "guest-1", "second");
    engine.cast(vote.id, "guest-2", "first");
    vi.advanceTimersByTime(30_000);
    expect(log.closed[0].result).toMatchObject({ winnerOptionId: "first", outcome: "tie_break" });
  });

  it("survives a server restart at 15s and still closes on time", () => {
    const first = harness(db);
    const vote = first.engine.open(contest);
    first.engine.cast(vote.id, "guest-1", "second");
    vi.advanceTimersByTime(15_000);

    // The server dies: its timers are gone, only the DB remains.
    first.engine.stop();
    vi.advanceTimersByTime(1_000);
    expect(first.log.closed).toHaveLength(0);

    const second = harness(db);
    expect(second.engine.rearm()).toBe(1);
    vi.advanceTimersByTime(13_999);
    expect(second.log.closed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(second.log.closed).toHaveLength(1);
    expect(second.log.closed[0].result).toMatchObject({ winnerOptionId: "second" });
    expect(second.log.closed[0].result.counts.second).toBe(1);
  });

  it("a vote whose deadline passed while the server was down closes right away", () => {
    const first = harness(db);
    const vote = first.engine.open(contest);
    first.engine.stop();
    vi.advanceTimersByTime(120_000);

    const second = harness(db);
    second.engine.rearm();
    vi.advanceTimersByTime(0);
    expect(second.log.closed).toHaveLength(1);
    expect(getVoteById(vote.id, db)?.status).toBe("closed");
  });

  it("a ban vote uses the active count at close: a guest leaving lowers the bar", () => {
    let active = 10; // need 5
    const { engine, log } = harness(db, () => active);
    const vote = engine.open({
      ...contest,
      type: "ban",
      options: [
        { id: "yes", label: "Ban it" },
        { id: "no", label: "Keep it" },
      ],
    });
    for (const g of ["guest-1", "guest-2", "guest-3", "guest-4"]) engine.cast(vote.id, g, "yes");
    active = 8; // two leave → need 4
    vi.advanceTimersByTime(30_000);
    expect(log.closed[0].result).toMatchObject({ winnerOptionId: "yes", outcome: "passed" });
    expect(getVoteById(vote.id, db)?.status).toBe("passed");
  });

  it("a kicked guest's ballot no longer counts", () => {
    const { engine, log } = harness(db);
    const vote = engine.open(contest);
    engine.cast(vote.id, "guest-1", "second");
    engine.cast(vote.id, "guest-2", "second");
    engine.cast(vote.id, "guest-3", "first");
    db.update(guests).set({ kickedAt: new Date() }).run();
    db.update(guests).set({ kickedAt: null }).where(eqId("guest-3")).run();
    vi.advanceTimersByTime(30_000);
    expect(log.closed[0].result.counts).toEqual({ first: 1, second: 0 });
  });

  it("tally emits at most 4 per second and always ends on the latest counts", () => {
    const { engine, log } = harness(db);
    const vote = engine.open(contest);
    for (let i = 0; i < 6; i++) {
      engine.cast(vote.id, `guest-${i + 1}`, i % 2 ? "first" : "second");
      vi.advanceTimersByTime(50); // 6 casts inside 300ms
    }
    vi.advanceTimersByTime(1_000);
    // first goes out immediately; the rest collapse into trailing emits ≥250ms apart
    expect(log.tallies.length).toBeLessThanOrEqual(3);
    expect(log.tallies[log.tallies.length - 1]).toMatchObject({ total: 6, counts: { first: 3, second: 3 } });

    const before = log.tallies.length;
    for (let i = 0; i < 40; i++) {
      engine.cast(vote.id, "guest-1", i % 2 ? "first" : "second");
      vi.advanceTimersByTime(25);
    }
    expect(log.tallies.length - before).toBeLessThanOrEqual(5); // 1s of spam → ≤ 4–5
  });

  it("refuses a ballot a validator rejects", () => {
    const hooks: VoteEngineHooks = {
      activeCount: () => 5,
      onOpened: () => {},
      onTally: () => {},
      onClosed: () => {},
      validateBallot: (_v, guestId, optionId) => (guestId === "guest-1" && optionId === "first" ? "Your song" : null),
    };
    const engine = createVoteEngine(hooks, db);
    const vote = engine.open(contest);
    expect(engine.cast(vote.id, "guest-1", "first")).toMatchObject({ ok: false, error: "not_allowed", reason: "Your song" });
    expect(engine.cast(vote.id, "guest-1", "second")).toMatchObject({ ok: true });
  });
});

import { eq } from "drizzle-orm";
function eqId(id: string) {
  return eq(guests.id, id);
}
