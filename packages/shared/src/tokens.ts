import type { RoomSettings } from "./room-settings.js";

export const TOKEN_REASONS = [
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
] as const;

export type TokenReason = (typeof TOKEN_REASONS)[number];

export interface TokenUpdatePayload {
  guestId: string;
  balance: number;
  delta: number;
  reason: TokenReason;
}

/** One row in the Me tab's token activity list — server-built label (the
 * ledger's refId is a queue item id, meaningless to the client on its own). */
export interface TokenActivityItem {
  id: string;
  delta: number;
  reason: TokenReason;
  label: string;
  createdAt: number;
}

/** Base token plus one replaySurcharge per prior play tonight (played or
 * skipped, house picks included) — pure so both server pricing and client
 * display compute the exact same number. */
export function priceFor(playsTonight: number, replaySurcharge: number): number {
  return 1 + replaySurcharge * playsTonight;
}

/** What adding a song to the queue costs right now — 0 when token mode is
 * off, otherwise the replay-aware price for how many times it's already
 * played tonight. */
export function queueAddPrice(settings: RoomSettings, playsTonight: number): number {
  return settings.tokenMode ? priceFor(playsTonight, settings.replaySurcharge) : 0;
}

/** A price above the cap can never be paid, no matter the balance — a
 * distinct state from "not enough tokens right now". */
export function isUnaffordableForever(cost: number, tokenCap: number): boolean {
  return cost > tokenCap;
}

/** Songs left until the next passive-income payout, and whether `finished`
 * (the count just reached after this song) is itself a payout tick. Pure so
 * the server's trigger check and the snapshot sent to phones agree exactly. */
export function passiveIncomeCadence(
  finished: number,
  earnEverySongs: number,
): { songsUntilNextToken: number; isPayoutTick: boolean } {
  const remainder = finished % earnEverySongs;
  return {
    songsUntilNextToken: earnEverySongs - remainder,
    isPayoutTick: finished > 0 && remainder === 0,
  };
}

export interface NoTokensResponse {
  error: "no_tokens";
  cost: number;
  balance: number;
}

export interface MaxReplaysResponse {
  error: "max_replays";
  cost: number;
  tokenCap: number;
}

export interface PriceChangedResponse {
  error: "price_changed";
  cost: number;
  balance: number;
}
