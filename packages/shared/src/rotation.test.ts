import { describe, it, expect } from "vitest";
import {
  projectUpcoming,
  applyWeightChange,
  onDeckSize,
  draft,
  openBallot,
  closeBallot,
  type DraftRoomState,
  type RotationGuest,
  type MysteryPoolEntry,
  type CrowdPickGuest,
} from "./rotation.js";

describe("onDeckSize", () => {
  it("scales with active guest count, clamped 2-5", () => {
    expect(onDeckSize(3)).toBe(2);
    expect(onDeckSize(25)).toBe(4);
    expect(onDeckSize(45)).toBe(5);
    expect(onDeckSize(0)).toBe(2);
    expect(onDeckSize(1000)).toBe(5);
  });
});

let nextSongId = 0;
function song(ownerId: string, count = 1) {
  return Array.from({ length: count }, () => ({
    id: `s${nextSongId++}`,
    ownerId,
    playsTonight: 0,
    hasDedication: false,
  }));
}

function guest(id: string, overrides: Partial<RotationGuest> = {}): RotationGuest {
  return {
    id,
    weight: 1,
    credit: 0,
    lastTurnAt: null,
    joinedAt: 0,
    active: true,
    queue: [],
    tokenBalance: 99,
    ...overrides,
  };
}

function baseState(overrides: Partial<DraftRoomState> = {}): DraftRoomState {
  return {
    onDeckSize: 1,
    onDeck: [],
    guests: [],
    pool: [],
    tokenMode: true,
    replaySurcharge: 1,
    mysteryEvery: 0,
    mysteryCounter: 0,
    onHouseDefault: false,
    housePick: () => ({ itemId: "house", ownerId: null, isMystery: false, isHousePick: true, chargedTokens: 0 }),
    rng: () => 0,
    ...overrides,
  };
}

describe("draft — rotation order", () => {
  it("5 guests, 20 songs, 2 empty queues: passes over the empty ones", () => {
    const guests = [
      guest("a", { queue: song("a", 7) }),
      guest("b", { queue: song("b", 7) }),
      guest("c", { queue: [] }),
      guest("d", { queue: song("d", 6) }),
      guest("e", { queue: [] }),
    ];
    const totalSongs = guests.reduce((sum, g) => sum + g.queue.length, 0);
    expect(totalSongs).toBe(20);

    let state = baseState({ onDeckSize: 3, guests });
    for (let i = 0; i < 6; i++) {
      const result = draft(state);
      for (const drafted of result.onDeck) {
        expect(drafted.ownerId).not.toBe("c");
        expect(drafted.ownerId).not.toBe("e");
      }
      // simulate on-deck songs playing out so the next draft() has room again
      state = { ...state, guests: result.guests, onDeck: [] };
    }
  });

  it("late joiner (credit 0, joinedAt after everyone) goes to the back", () => {
    const early = guest("early", { queue: song("early", 1), joinedAt: 0 });
    const late = guest("late", { queue: song("late", 1), joinedAt: 1000 });
    const state = baseState({ onDeckSize: 1, guests: [late, early] });
    const result = draft(state);
    expect(result.onDeck[0].ownerId).toBe("early");
  });

  it("a broke guest is passed over, keeps their place, and is notified", () => {
    const broke = guest("broke", { queue: song("broke", 1), tokenBalance: 0 });
    const flush = guest("flush", { queue: song("flush", 1), tokenBalance: 99, joinedAt: 1 });
    const state = baseState({ onDeckSize: 1, guests: [broke, flush] });
    const result = draft(state);

    // broke is tried first (tie-broken by joining first) but can't afford it, so flush's song is drafted instead
    expect(result.onDeck[0].ownerId).toBe("flush");
    const brokeAfter = result.guests.find((g) => g.id === "broke")!;
    expect(brokeAfter.queue).toHaveLength(1); // kept their place, not removed
    expect(result.notifications).toEqual([{ guestId: "broke", reason: "turn_skipped", tokensNeeded: 1 }]);
  });

  it("onHouseDefault drafts a broke guest anyway, token balance floors at 0", () => {
    const broke = guest("broke", { queue: song("broke", 1), tokenBalance: 0 });
    const state = baseState({ onDeckSize: 1, guests: [broke], onHouseDefault: true });
    const result = draft(state);
    expect(result.onDeck[0].ownerId).toBe("broke");
    expect(result.onDeck[0].chargedTokens).toBe(0);
    expect(result.notifications).toHaveLength(0);
    expect(result.guests[0].tokenBalance).toBe(0);
  });

  it("token mode off: everything is free, nobody is ever passed over", () => {
    const broke = guest("broke", { queue: song("broke", 1), tokenBalance: 0 });
    const state = baseState({ onDeckSize: 1, guests: [broke], tokenMode: false });
    const result = draft(state);
    expect(result.onDeck[0].ownerId).toBe("broke");
    expect(result.onDeck[0].chargedTokens).toBe(0);
    expect(result.notifications).toHaveLength(0);
  });

  it("everyone empty: fills every slot from the house pick", () => {
    const state = baseState({ onDeckSize: 3, guests: [guest("a"), guest("b")] });
    const result = draft(state);
    expect(result.onDeck).toHaveLength(3);
    expect(result.onDeck.every((d) => d.isHousePick)).toBe(true);
  });

  it("inactive guests are never drafted even with songs queued", () => {
    const inactive = guest("i", { queue: song("i", 1), active: false });
    const state = baseState({ onDeckSize: 1, guests: [inactive] });
    const result = draft(state);
    expect(result.onDeck[0].isHousePick).toBe(true);
  });

  it("fairness: 10 guests at weight 1, 50 turns → each gets 5 ± 1", () => {
    let guests = Array.from({ length: 10 }, (_, i) => guest(`g${i}`, { joinedAt: i }));
    const counts: Record<string, number> = {};
    for (let turn = 0; turn < 50; turn++) {
      for (const g of guests) if (g.queue.length === 0) g.queue.push(...song(g.id, 1));
      const state = baseState({ onDeckSize: 1, guests });
      const result = draft(state, turn);
      const drafted = result.onDeck[0];
      counts[drafted.ownerId!] = (counts[drafted.ownerId!] ?? 0) + 1;
      guests = result.guests;
    }
    for (const g of guests) {
      expect(counts[g.id]).toBeGreaterThanOrEqual(4);
      expect(counts[g.id]).toBeLessThanOrEqual(6);
    }
  });

  it("weights: one guest at x2 among four at x1 gets about 40% of turns, never 3 in a row", () => {
    let guests = [
      guest("boosted", { weight: 2, joinedAt: 0 }),
      guest("a", { joinedAt: 1 }),
      guest("b", { joinedAt: 2 }),
      guest("c", { joinedAt: 3 }),
    ];
    const counts: Record<string, number> = {};
    let streak = 0;
    let maxStreak = 0;
    let lastWinner: string | null = null;
    const TURNS = 100;
    for (let turn = 0; turn < TURNS; turn++) {
      for (const g of guests) if (g.queue.length === 0) g.queue.push(...song(g.id, 1));
      const state = baseState({ onDeckSize: 1, guests });
      const result = draft(state, turn);
      const winner = result.onDeck[0].ownerId!;
      counts[winner] = (counts[winner] ?? 0) + 1;
      streak = winner === lastWinner ? streak + 1 : 1;
      maxStreak = Math.max(maxStreak, streak);
      lastWinner = winner;
      guests = result.guests;
    }
    const boostedShare = counts.boosted / TURNS;
    expect(boostedShare).toBeGreaterThan(0.32);
    expect(boostedShare).toBeLessThan(0.48);
    expect(maxStreak).toBeLessThan(3);
  });

  it("mystery slot fires once the counter reaches the threshold, and resets it", () => {
    const guests = [guest("a", { queue: song("a", 10) })];
    const pool: MysteryPoolEntry[] = [
      { id: "m1", ownerId: "a", playsTonight: 0, waitingSince: 100 },
      { id: "m2", ownerId: "a", playsTonight: 0, waitingSince: 0 }, // oldest — favoured by rng()=0
    ];
    const state = baseState({ onDeckSize: 1, guests, pool, mysteryEvery: 5, mysteryCounter: 5 });
    const result = draft(state);
    expect(result.onDeck).toHaveLength(1);
    expect(result.onDeck[0].isMystery).toBe(true);
    expect(result.onDeck[0].itemId).toBe("m2"); // longest-waiting, picked deterministically via rng()=0
    expect(result.pool).toHaveLength(1);
    // reset lands on -1/0/1 (±1 jitter, §7) — with the default rng()=0 that's always -1
    expect(result.mysteryCounter).toBe(-1);
  });

  it("mystery counter only ticks on normal slots, not on the mystery slot itself", () => {
    const guests = [guest("a", { queue: song("a", 10) })];
    const pool: MysteryPoolEntry[] = [{ id: "m1", ownerId: "a", playsTonight: 0, waitingSince: 0 }];
    // starts one below threshold: slot 1 is normal (counter -> 5), slot 2 triggers mystery (jitter-reset
    // to -1 with the default rng()=0), slots 3-5 are normal again (counter -> 2)
    const state = baseState({ onDeckSize: 5, guests, pool, mysteryEvery: 5, mysteryCounter: 4 });
    const result = draft(state);
    expect(result.onDeck.filter((d) => d.isMystery)).toHaveLength(1);
    expect(result.onDeck[1].isMystery).toBe(true);
    expect(result.mysteryCounter).toBe(2);
  });

  it("mystery reset jitters -1/0/1 (§7), never always the same slot count later", () => {
    const guests = [guest("a", { queue: song("a", 10) })];
    const pool: MysteryPoolEntry[] = [{ id: "m1", ownerId: "a", playsTonight: 0, waitingSince: 0 }];
    const resets = [0, 0.5, 0.99].map((roll) => {
      const state = baseState({ onDeckSize: 1, guests, pool: [...pool], mysteryEvery: 5, mysteryCounter: 5, rng: () => roll });
      return draft(state).mysteryCounter;
    });
    expect(resets).toEqual([-1, 0, 1]);
  });

  it("R9 done check: a whole mystery slot leaves the rotation strip and counts untouched, owner hidden", () => {
    const a = guest("a", { queue: song("a", 1), credit: 3, weight: 2 });
    const b = guest("b", { queue: song("b", 1), credit: -1 });
    const pool: MysteryPoolEntry[] = [{ id: "pool-1", ownerId: "a", playsTonight: 0, waitingSince: 0 }];
    const state = baseState({ onDeckSize: 1, guests: [a, b], pool, mysteryEvery: 5, mysteryCounter: 5 });

    const result = draft(state);
    expect(result.onDeck[0].isMystery).toBe(true);
    expect(result.onDeck[0].ownerId).toBe("a"); // kept internally — the server still needs it to charge/refund
    // "the strip doesn't change": nobody's turn was used, so credit and every guest's own queue are untouched
    const [resultA, resultB] = result.guests;
    expect(resultA.credit).toBe(3);
    expect(resultA.queue).toHaveLength(1); // the pool song was never in their own queue to begin with
    expect(resultB.credit).toBe(-1);
  });
});

function cpGuest(id: string, overrides: Partial<CrowdPickGuest> = {}): CrowdPickGuest {
  return {
    id,
    weight: 1,
    credit: 0,
    lastTurnAt: null,
    joinedAt: 0,
    active: true,
    queue: [],
    tokenBalance: 99,
    lostRounds: 0,
    ...overrides,
  };
}

describe("Crowd pick: openBallot / closeBallot (R10)", () => {
  it("the winner is drafted, credit resets, and their song leaves their queue", () => {
    const a = cpGuest("a", { queue: song("a", 1), joinedAt: 0 });
    const b = cpGuest("b", { queue: song("b", 1), joinedAt: 1 });
    const { guests, ballot } = openBallot([a, b], 6, 3);
    expect(ballot).toHaveLength(2);

    const votes = { voter1: ballot[0].itemId, voter2: ballot[0].itemId, voter3: ballot[1].itemId };
    const result = closeBallot(ballot, votes, guests, 1000);
    expect(result.winnerItemId).toBe(ballot[0].itemId);
    const winnerGuest = result.guests.find((g) => g.id === ballot[0].ownerId)!;
    expect(winnerGuest.queue).toHaveLength(0);
    expect(winnerGuest.lastTurnAt).toBe(1000);
    expect(winnerGuest.credit).toBe(0); // the one turn this round, used
  });

  it("self-votes count like any other vote", () => {
    const a = cpGuest("a", { queue: song("a", 1) });
    const b = cpGuest("b", { queue: song("b", 1) });
    const { guests, ballot } = openBallot([a, b], 6, 3);
    const aEntry = ballot.find((c) => c.ownerId === "a")!;
    // "a" votes for their own song, nobody else votes
    const result = closeBallot(ballot, { a: aEntry.itemId }, guests, 0);
    expect(result.winnerItemId).toBe(aEntry.itemId);
  });

  it("losers carry over: lostRounds increments only for guests actually on the ballot", () => {
    const a = cpGuest("a", { queue: song("a", 1) });
    const b = cpGuest("b", { queue: song("b", 1) });
    const { guests, ballot } = openBallot([a, b], 6, 3);
    const winnerEntry = ballot.find((c) => c.ownerId === "a")!;
    const result = closeBallot(ballot, { v: winnerEntry.itemId }, guests, 0);
    const loser = result.guests.find((g) => g.id === "b")!;
    const winner = result.guests.find((g) => g.id === "a")!;
    expect(loser.lostRounds).toBe(1);
    expect(winner.lostRounds).toBe(0);
  });

  it("a 3-round loser is flagged a wildcard and forced to win its 4th round even against votes", () => {
    const a = cpGuest("a", { queue: song("a", 1), lostRounds: 3 }); // already lost 3 in a row
    const b = cpGuest("b", { queue: song("b", 1) });
    const { guests, ballot } = openBallot([a, b], 6, 3);
    const aEntry = ballot.find((c) => c.ownerId === "a")!;
    const bEntry = ballot.find((c) => c.ownerId === "b")!;
    expect(aEntry.isWildcard).toBe(true);

    // everyone votes for b — a should still win, forced, as its 4th loss would otherwise land
    const result = closeBallot(ballot, { v1: bEntry.itemId, v2: bEntry.itemId, v3: bEntry.itemId }, guests, 0);
    expect(result.winnerItemId).toBe(aEntry.itemId);
  });

  it("ties go to whoever's waited longest; no votes falls back to rotation order (highest credit)", () => {
    const a = cpGuest("a", { queue: song("a", 1), lastTurnAt: 500, credit: 5 });
    const b = cpGuest("b", { queue: song("b", 1), lastTurnAt: 100, credit: 1 });
    const { guests, ballot } = openBallot([a, b], 6, 3);
    const aEntry = ballot.find((c) => c.ownerId === "a")!;
    const bEntry = ballot.find((c) => c.ownerId === "b")!;

    const tie = closeBallot(ballot, { v1: aEntry.itemId, v2: bEntry.itemId }, guests, 0);
    expect(tie.winnerItemId).toBe(bEntry.itemId); // waited longer (lastTurnAt further in the past)

    const noVotes = closeBallot(ballot, {}, guests, 0);
    expect(noVotes.winnerItemId).toBe(aEntry.itemId); // higher credit decides instead
  });

  it("R10 done check: credit-based admission — a x2 guest gets about twice the turns of a x1 guest", () => {
    let guests: CrowdPickGuest[] = [
      cpGuest("boosted", { weight: 2, joinedAt: 0 }),
      cpGuest("a", { joinedAt: 1 }),
      cpGuest("b", { joinedAt: 2 }),
      cpGuest("c", { joinedAt: 3 }),
    ];
    const admitted: Record<string, number> = {};
    const won: Record<string, number> = {};
    // The crowd's taste, as a fixed pseudo-random sequence: any ballot entry can win.
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const ROUNDS = 600;
    for (let round = 0; round < ROUNDS; round++) {
      for (const g of guests) if (g.queue.length === 0) g.queue.push(...song(g.id, 1));
      // ballot size 2 out of 4 eligible — forces real competition for admission (§20 scenario 2)
      const opened = openBallot(guests, 2, 99);
      for (const c of opened.ballot) admitted[c.ownerId] = (admitted[c.ownerId] ?? 0) + 1;
      const pick = opened.ballot[Math.floor(rand() * opened.ballot.length)];
      const closed = closeBallot(opened.ballot, { v: pick.itemId }, opened.guests, round);
      won[pick.ownerId] = (won[pick.ownerId] ?? 0) + 1;
      guests = closed.guests;
    }
    for (const other of ["a", "b", "c"]) {
      expect(admitted.boosted).toBeGreaterThan(admitted[other]);
      const ratio = won.boosted / won[other];
      expect(ratio).toBeGreaterThan(1.6);
      expect(ratio).toBeLessThan(2.5);
    }
  });
});

describe("draft — rounds and weights", () => {
  /** Runs draft() one slot at a time, refilling queues, and returns the owners in order. */
  function sequence(start: RotationGuest[], slots: number, boostedTurns: "together" | "spread" = "together") {
    let guests = start;
    const out: string[] = [];
    for (let t = 0; t < slots; t++) {
      for (const g of guests) if (g.queue.length === 0) g.queue.push(...song(g.id, 2));
      const result = draft(baseState({ onDeckSize: 1, guests, boostedTurns }), 1000 + t * 10);
      out.push(result.onDeck[0].ownerId!);
      guests = result.guests;
    }
    return { out, guests };
  }
  const four = (w: number) => [guest("A", { weight: w, joinedAt: 0 }), guest("B", { joinedAt: 1 }), guest("C", { joinedAt: 2 }), guest("D", { joinedAt: 3 })];

  it("×2 back to back: two songs every round from the very first, as a pair", () => {
    expect(sequence(four(2), 15).out.join("")).toBe("AABCDAABCDAABCD");
  });

  it("×2 spread: two songs every round, never twice running", () => {
    const { out } = sequence(four(2), 25, "spread");
    for (let i = 1; i < out.length; i++) expect(out[i] === "A" && out[i - 1] === "A").toBe(false);
    for (let r = 0; r < 5; r++) expect(out.slice(r * 5, r * 5 + 5).filter((x) => x === "A")).toHaveLength(2);
  });

  it("×1.5 gets 3 songs per 2 rounds; ×0.5 one every other round; ×3 never more than 3 in a row", () => {
    expect(sequence(four(1.5), 9).out.filter((x) => x === "A")).toHaveLength(3);
    const half = sequence(four(0.5), 7).out;
    expect(half.filter((x) => x === "A")).toHaveLength(1);
    expect(sequence(four(3), 24).out.join("")).not.toMatch(/AAAA/);
  });

  it("a weight raised mid-round adds the extra turn to this round (the forecast reshapes at once)", () => {
    const { guests } = sequence(four(1), 2); // A, B have gone this round
    const before = projectUpcoming(baseState({ guests, onDeckSize: 0 }), 4).map((s) => s.ownerId).join("");
    expect(before).toBe("CDAB");
    const a = guests.find((g) => g.id === "A")!;
    Object.assign(a, applyWeightChange(a, 2)); // what setGuestWeight does on the server
    const after = projectUpcoming(baseState({ guests, onDeckSize: 0 }), 4).map((s) => s.ownerId).join("");
    expect(after).toBe("ACDB"); // the extra turn plays next
  });

  it("a joiner mid-round (no turns left) waits for the next round", () => {
    const { guests } = sequence(four(1), 1); // A has gone
    guests.push(guest("E", { joinedAt: 9, credit: 0, queue: song("E", 2) }));
    expect(projectUpcoming(baseState({ guests, onDeckSize: 0 }), 5).map((s) => s.ownerId).join("")).toBe("BCDEA"); // E's first turn opens the next round
  });
});

describe("draft — no house music (no fallback playlist)", () => {
  const noHouse = () => {
    throw new Error("no fallback playlist");
  };

  it("keeps the slots it could fill instead of throwing them all away", () => {
    const state = baseState({
      onDeckSize: 2,
      housePick: noHouse,
      guests: [
        guest("broke-a", { tokenBalance: 0, joinedAt: 0, queue: song("broke-a", 3) }),
        guest("broke-b", { tokenBalance: 0, joinedAt: 1, queue: song("broke-b", 3) }),
        guest("payer", { tokenBalance: 1, joinedAt: 2, queue: song("payer", 1) }),
      ],
    });
    const result = draft(state);
    expect(result.onDeck.map((d) => d.ownerId)).toEqual(["payer"]);
  });

  it("lets the next guest play on the house rather than leave on deck empty", () => {
    const state = baseState({
      onDeckSize: 2,
      housePick: noHouse,
      guests: [
        guest("a", { tokenBalance: 0, joinedAt: 0, queue: song("a", 2) }),
        guest("b", { tokenBalance: 0, joinedAt: 1, queue: song("b", 2) }),
      ],
    });
    const result = draft(state);
    expect(result.onDeck).toHaveLength(1);
    expect(result.onDeck[0]).toMatchObject({ ownerId: "a", chargedTokens: 0, isHousePick: false });
    // the guest who got the free turn isn't told their turn was skipped
    expect(result.notifications.some((n) => n.guestId === "a")).toBe(false);
  });

  it("still throws when there's genuinely nothing to play", () => {
    expect(() => draft(baseState({ housePick: noHouse, guests: [guest("a")] }))).toThrow();
  });
});

describe("draft — house picks give way to guest songs", () => {
  const house = (id: string, canYield = true) => ({ itemId: id, ownerId: null, isMystery: false, isHousePick: true, chargedTokens: 0, canYield });

  it("guest songs take the slots of house picks that haven't started", () => {
    const r = draft(
      baseState({
        onDeckSize: 3,
        onDeck: [house("h1", false), house("h2"), house("h3")],
        guests: [guest("a", { queue: song("a", 2) }), guest("b", { queue: song("b", 1) })],
      }),
    );
    expect(r.yieldedHousePicks).toEqual(["h2", "h3"]);
    expect(r.onDeck.map((o) => o.ownerId)).toEqual([null, "a", "b"]);
  });

  it("only as many as guests can fill, newest first", () => {
    const r = draft(baseState({ onDeckSize: 3, onDeck: [house("h1"), house("h2"), house("h3")], guests: [guest("a", { queue: song("a", 1) })] }));
    expect(r.yieldedHousePicks).toEqual(["h3"]);
    expect(r.onDeck.map((o) => o.itemId).slice(0, 2)).toEqual(["h1", "h2"]);
  });

  it("a guest who can't pay doesn't swap one house pick for another", () => {
    let picks = 0;
    const r = draft(
      baseState({
        onDeckSize: 2,
        onDeck: [house("h1"), house("h2")],
        guests: [guest("a", { queue: song("a", 1), tokenBalance: 0 })],
        housePick: () => ({ ...house(`new${picks++}`), canYield: undefined }),
      }),
    );
    expect(r.yieldedHousePicks).toEqual([]);
    expect(picks).toBe(0);
    expect(r.notifications).toEqual([]);
  });

  it("house picks marked as not yieldable stay put", () => {
    const r = draft(baseState({ onDeckSize: 1, onDeck: [house("h1", false)], guests: [guest("a", { queue: song("a", 1) })] }));
    expect(r.yieldedHousePicks).toEqual([]);
    expect(r.onDeck.map((o) => o.itemId)).toEqual(["h1"]);
  });
});

describe("projectUpcoming — the live main queue forecast", () => {
  it("follows turn order across personal queues and stops at house music", () => {
    const a = song("a", 2);
    const b = song("b", 1);
    const slots = projectUpcoming(
      baseState({ onDeckSize: 1, guests: [guest("a", { queue: a, joinedAt: 0 }), guest("b", { queue: b, joinedAt: 1 })] }),
      10,
    );
    expect(slots.map((s) => s.kind === "guest" ? s.itemId : s.kind)).toEqual([a[0].id, b[0].id, a[1].id, "house"]);
  });

  it("leaves on deck and the caller's state alone", () => {
    const g = guest("a", { queue: song("a", 2) });
    const onDeck = [{ itemId: "h1", ownerId: null, isMystery: false, isHousePick: true, chargedTokens: 0, canYield: true }];
    const slots = projectUpcoming(baseState({ onDeckSize: 1, onDeck, guests: [g] }), 5);
    expect(slots.filter((s) => s.kind === "guest")).toHaveLength(2);
    expect(g.queue).toHaveLength(2);
    expect(onDeck[0].canYield).toBe(true);
  });

  it("hides mystery picks", () => {
    const slots = projectUpcoming(
      baseState({ mysteryEvery: 1, mysteryCounter: 1, pool: [{ id: "p1", ownerId: "a", playsTonight: 0, waitingSince: 0 }] }),
      2,
    );
    expect(slots[0]).toEqual({ kind: "mystery", itemId: null, ownerId: null });
  });
});
