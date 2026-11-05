import { describe, it, expect } from "vitest";
import { priceFor, queueAddPrice, isUnaffordableForever, passiveIncomeCadence } from "./tokens.js";
import { DEFAULT_ROOM_SETTINGS } from "./room-settings.js";

describe("priceFor", () => {
  it("is 1 token for a first play", () => {
    expect(priceFor(0, 1)).toBe(1);
  });

  it("adds one surcharge per prior play", () => {
    expect(priceFor(1, 1)).toBe(2);
    expect(priceFor(2, 1)).toBe(3);
  });

  it("scales with a non-default surcharge", () => {
    expect(priceFor(2, 3)).toBe(1 + 3 * 2);
  });
});

describe("queueAddPrice", () => {
  it("is 0 when token mode is off, regardless of replays", () => {
    const settings = { ...DEFAULT_ROOM_SETTINGS, tokenMode: false };
    expect(queueAddPrice(settings, 3)).toBe(0);
  });

  it("uses priceFor when token mode is on", () => {
    const settings = { ...DEFAULT_ROOM_SETTINGS, tokenMode: true, replaySurcharge: 1 };
    expect(queueAddPrice(settings, 0)).toBe(1);
    expect(queueAddPrice(settings, 1)).toBe(2);
  });
});

describe("isUnaffordableForever", () => {
  it("is true once the price exceeds the cap", () => {
    expect(isUnaffordableForever(6, 5)).toBe(true);
    expect(isUnaffordableForever(5, 5)).toBe(false);
    expect(isUnaffordableForever(4, 5)).toBe(false);
  });
});

describe("passiveIncomeCadence", () => {
  it("counts down to the next payout and isn't a tick yet", () => {
    expect(passiveIncomeCadence(0, 2)).toEqual({ songsUntilNextToken: 2, isPayoutTick: false });
    expect(passiveIncomeCadence(1, 2)).toEqual({ songsUntilNextToken: 1, isPayoutTick: false });
  });

  it("is a payout tick exactly every earnEverySongs finished songs", () => {
    expect(passiveIncomeCadence(2, 2)).toEqual({ songsUntilNextToken: 2, isPayoutTick: true });
    expect(passiveIncomeCadence(4, 2)).toEqual({ songsUntilNextToken: 2, isPayoutTick: true });
    expect(passiveIncomeCadence(3, 2)).toEqual({ songsUntilNextToken: 1, isPayoutTick: false });
  });

  it("0 finished is never a tick, even though the remainder is 0", () => {
    expect(passiveIncomeCadence(0, 3).isPayoutTick).toBe(false);
  });
});
