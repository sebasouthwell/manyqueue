import { priceFor } from "./tokens.js";

// ---- Client-facing view types (R4) ----

/** One song in a guest's own queue — their private view, never sent to anyone else. */
export interface MineQueueItemView {
  id: string;
  trackUri: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  dedication: string | null;
  /** In the mystery pool, not this guest's ordered queue — shown separately in the sheet. */
  inPool: boolean;
}

/** One on-deck slot, everyone's view. */
export interface OnDeckItemView {
  id: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  /** Null for a mystery pick or a house pick — nobody's name goes with those. */
  addedBy: { nickname: string; emoji: string } | null;
  isMystery: boolean;
  /** Slot 1, already handed to Spotify — can't be changed. */
  locked: boolean;
  /** Won a Crowd pick vote: "Picked by the crowd · from 🦋 Maya" (§6). */
  pickedByCrowd?: boolean;
}

/** One song on the Crowd pick ballot, everyone's view (§6, D11): the title, never the owner. A guest's
 * client marks its own ("Yours") by matching itemId against its own queue. */
export interface BallotEntryView {
  itemId: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  isMystery: boolean;
  isWildcard: boolean;
  /** Only when the host turned on wait time (D14); null otherwise. */
  lostRounds: number | null;
  votes: number;
}

/** The open ballot. Each phone shuffles the entries with its own seed, so there's no top-of-list bias. */
export interface BallotView {
  id: string;
  /** epoch ms the vote is expected to close (the song's end minus the close lead); null when unknown. */
  closesAt: number | null;
  entries: BallotEntryView[];
  totalVotes: number;
}

/** The host's ballot: the same plus each owner (not for mystery songs, D11). */
export interface HostBallotEntryView extends BallotEntryView {
  owner: { guestId: string; nickname: string; emoji: string } | null;
}
export interface HostBallotView extends Omit<BallotView, "entries"> {
  entries: HostBallotEntryView[];
}

/** One guest's row in the rotation strip — counts only, no weights, no personal-queue titles (§12). */
export interface RotationGuestView {
  guestId: string;
  nickname: string;
  emoji: string;
  /** Personal-queue song count; pool songs are never counted here. */
  count: number;
  /** True once a guest has no songs and is being passed over — dims their row (§5.2 rule 3). */
  empty: boolean;
}

/** Everyone's view of Rotation mode's shared state — the Room tab and the TV both render from this. */
/** One slot of the live "coming up" forecast after on deck: what draft() would pick next if nothing
 * changed. No titles: personal queue titles stay with their owner and the host (§12). A guest's own
 * slots come in their queue order, so their client can put titles on those itself. */
export interface UpcomingItemView {
  kind: "guest" | "mystery" | "house";
  guestId: string | null;
  addedBy: { nickname: string; emoji: string } | null;
}

export interface RotationRoomView {
  onDeck: OnDeckItemView[];
  rotation: RotationGuestView[];
  upcoming: UpcomingItemView[];
  /** Crowd pick's open ballot; null in rotation order or between rounds. */
  ballot: BallotView | null;
}

/** The host board's forecast slot: same as UpcomingItemView plus the title. */
export interface HostUpcomingItemView extends UpcomingItemView {
  /** The guest song this slot would draft, for "Draft now"; null for mystery and house slots. */
  itemId: string | null;
  trackName: string | null;
  albumArtUrl: string | null;
  artistName: string | null;
}

/** One song in the host board's per-guest column — titles the general rotation:update never carries. */
export interface HostRotationSongView {
  id: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  dedication: string | null;
}

/** One guest's column on the host Queues board (§9, mockup 4e) — the host's privileged view of a
 * personal queue (§12 "personal queue titles are visible only to their owner and the host"). */
export interface HostRotationGuestView {
  guestId: string;
  nickname: string;
  emoji: string;
  weight: number;
  tokenBalance: number;
  canAfford: boolean;
  empty: boolean;
  songs: HostRotationSongView[];
}

/** The mystery pool as the host sees it — titles, never owners (D11; "See anonymous owners" isn't
 * built yet, so this stays off unconditionally rather than half-implementing that toggle). */
export interface HostPoolSongView {
  id: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
}

/** Host/co-host only (§15 rotation:host) — the full Queues board: every guest's real queue, in
 * rotation order, plus the pool. Never sent to a plain guest socket. */
export interface HostRotationBoardView {
  onDeck: OnDeckItemView[];
  guests: HostRotationGuestView[];
  pool: HostPoolSongView[];
  upcoming: HostUpcomingItemView[];
  ballot: HostBallotView | null;
  /** Auto + veto (§9): the song rotation drafts when this countdown ends, while the host can still
   * Swap or Skip it. Null outside the 15s window. */
  pendingDraft: PendingDraftView | null;
}

export interface PendingDraftView extends HostUpcomingItemView {
  /** Server ms when it commits. */
  commitsAt: number;
}

/** Private, only ever sent above x1 (§8) — the "⭐ Host boost" card. */
export interface MyWeightPayload {
  weight: number;
}

/** ×0.5–×3, host-set (§8). Everyone starts at ×1; there's no smaller step in between these. */
export const TURN_WEIGHTS = [0.5, 0.75, 1, 1.5, 2, 3] as const;

/**
 * Rotation order's fairness rule (§8). Credit is "how far up the line you are": highest goes next, and a
 * turn costs 1/weight, so a ×2 guest gets twice the turns of a ×1 guest and, at ×1, the next turn goes to
 * whoever has had the fewest, ties to whoever waited longest — §5's promise. A guest joining mid-party
 * starts level with the most-served guest (ensureRotationState on the server), i.e. at the end of the line.
 *
 * This replaced textbook smooth weighted round-robin (+weight to everyone, -total to the winner). That
 * one is only fair while the set of guests never changes, and in a party it changes constantly: a
 * draft charged "total weight" while Cris was still in cost Ana and Ben a point more than everyone
 * charged after Cris's one song was gone, so they went to the back of round 2 (seen live: Ana waited
 * 18 songs while Dani had 3). Here a turn's cost depends only on the guest's own weight, so people
 * coming and going can't move anyone else's place.
 *
 * The one clamp (mutates the credit of the guests eligible for this slot): nobody is more than one turn
 * ahead of the most-served eligible guest. A guest back from an empty queue or from being inactive keeps
 * their place (one prompt turn) but can't cash in a backlog of turns in a row (§5 rules 3 and 5). Guests
 * who stayed in the whole time are never touched by it: their credits never spread wider than one turn.
 */
export function clampTurnCredit<T extends { credit: number; weight: number }>(eligible: T[]): void {
  if (eligible.length === 0) return;
  const mostServed = Math.min(...eligible.map((g) => g.credit));
  const ceiling = mostServed + Math.max(...eligible.map((g) => turnCost(g.weight)));
  for (const g of eligible) if (g.credit > ceiling) g.credit = ceiling;
}

/** What one turn costs a guest's credit (see clampTurnCredit). */
export function turnCost(weight: number): number {
  return 1 / weight;
}

/** How many songs on deck at once — scales with the room instead of being a
 * fixed setting (D9, the Rotation-mode design §4/§13): a 5-guest party doesn't need
 * slot padding, a 40-guest one needs more than a fixed 3. */
export function onDeckSize(activeGuestCount: number): number {
  return Math.min(5, Math.max(2, 2 + Math.floor(activeGuestCount / 10)));
}

export interface RotationSong {
  id: string;
  ownerId: string;
  playsTonight: number;
  hasDedication: boolean;
}

export interface RotationGuest {
  id: string;
  /** ×0.5–×3, host-set (§8); 1 for everyone by default. */
  weight: number;
  credit: number;
  /** epoch ms of this guest's last drafted turn, null if they've never had one. */
  lastTurnAt: number | null;
  joinedAt: number;
  /** false = dropped from the rotation (inactive, kicked); keeps their place but never drafted. */
  active: boolean;
  /** Ordered; index 0 is "next from you". */
  queue: RotationSong[];
  tokenBalance: number;
}

export interface MysteryPoolEntry {
  id: string;
  ownerId: string;
  playsTonight: number;
  /** epoch ms the song entered the pool — the mystery pick favours whoever's waited longest. */
  waitingSince: number;
}

export interface DraftedSong {
  itemId: string;
  /** null only for a house pick — everything else keeps an owner even when it's hidden from guests
   * (mystery items), since the server still needs it to charge/refund and for the host's own view. */
  ownerId: string | null;
  isMystery: boolean;
  isHousePick: boolean;
  chargedTokens: number;
  /** A house pick that hasn't started and isn't next to start: draft() may hand its slot to a guest. */
  canYield?: boolean;
}

export interface TurnSkippedNotification {
  guestId: string;
  reason: "turn_skipped";
  tokensNeeded: number;
}

export interface DraftRoomState {
  onDeckSize: number;
  onDeck: DraftedSong[];
  guests: RotationGuest[];
  pool: MysteryPoolEntry[];
  /** Room setting: when off, every price is 0 and nobody is ever passed over for lacking tokens. */
  tokenMode: boolean;
  replaySurcharge: number;
  /** 0 (or less) turns mystery slots off. */
  mysteryEvery: number;
  /** Normal (non-mystery) slots filled since the last mystery slot. */
  mysteryCounter: number;
  /** A guest who can't afford their turn is drafted anyway, on the house, instead of being passed
   * over (§5.2 rule 4 default is passed-over; this flips that per-room, `on_house_default` in §14). */
  onHouseDefault: boolean;
  /** Produces one fallback-playlist pick; called whenever nobody has a song to draft (§5.2 rule 7). */
  housePick: () => DraftedSong;
  /** Injectable for deterministic tests; defaults to Math.random. */
  rng?: () => number;
}

export interface DraftResult {
  onDeck: DraftedSong[];
  guests: RotationGuest[];
  pool: MysteryPoolEntry[];
  mysteryCounter: number;
  notifications: TurnSkippedNotification[];
  /** House picks taken off on deck to make room for guest songs; the caller deletes them. */
  yieldedHousePicks: string[];
}

/** How many guest songs draft() could place right now without a house pick, up to `max`. Mirrors the
 * loop's own choice (credit order, first guest who can pay), on a scratch copy. */
function placeableGuestSongs(state: DraftRoomState, max: number): number {
  const guests = state.guests.map((g) => ({ ...g, queue: [...g.queue] }));
  let placed = 0;
  while (placed < max) {
    const eligible = guests.filter((g) => g.active && g.queue.length > 0);
    clampTurnCredit(eligible);
    const payer = eligible
      .sort((a, b) => b.credit - a.credit)
      .find((g) => state.onHouseDefault || g.tokenBalance >= priceOf(g.queue[0], state.replaySurcharge, state.tokenMode));
    if (!payer) break;
    payer.tokenBalance -= priceOf(payer.queue[0], state.replaySurcharge, state.tokenMode);
    payer.queue = payer.queue.slice(1);
    payer.credit -= turnCost(payer.weight);
    placed++;
  }
  return placed;
}

function priceOf(song: RotationSong, replaySurcharge: number, tokenMode: boolean): number {
  if (!tokenMode) return 0;
  return priceFor(song.playsTonight, replaySurcharge) + (song.hasDedication ? 1 : 0);
}

/** A random pool song, weighted toward whichever has waited longest (§7). */
function pickMysterySong(pool: MysteryPoolEntry[], rng: () => number): MysteryPoolEntry {
  const byWait = [...pool].sort((a, b) => a.waitingSince - b.waitingSince);
  const weights = byWait.map((_, i) => byWait.length - i);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < byWait.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return byWait[i];
  }
  return byWait[byWait.length - 1];
}

/**
 * Fills on-deck slots one at a time — rotation order only; Crowd pick doesn't call this at all (see
 * openBallot()/closeBallot(), §5.4, D12). A pure function over a fresh working copy of `state`: the
 * caller's guests/pool/onDeck arrays are never mutated, only read.
 */
export function draft(state: DraftRoomState, now = Date.now()): DraftResult {
  const rng = state.rng ?? Math.random;
  let onDeck = [...state.onDeck];
  let pool = [...state.pool];
  let mysteryCounter = state.mysteryCounter;
  const guests = state.guests.map((g) => ({ ...g, queue: [...g.queue] }));
  const notifications: TurnSkippedNotification[] = [];

  // House picks are filler for when nobody has a song. Once guests do, the ones that haven't started
  // give their slots back, newest first; otherwise a room that filled up with house music while
  // everyone's queue was empty kept playing it until each pick finished. Only as many as guests can
  // actually fill, or a guest who can't pay would trade one house pick for another every tick.
  const yieldedHousePicks: string[] = [];
  const yieldable = onDeck.filter((o) => o.isHousePick && o.canYield);
  if (yieldable.length > 0) {
    const give = placeableGuestSongs(state, yieldable.length);
    for (const o of yieldable.slice(yieldable.length - give)) yieldedHousePicks.push(o.itemId);
    onDeck = onDeck.filter((o) => !yieldedHousePicks.includes(o.itemId));
  }

  while (onDeck.length < state.onDeckSize) {
    if (state.mysteryEvery > 0 && mysteryCounter >= state.mysteryEvery && pool.length > 0) {
      const chosen = pickMysterySong(pool, rng);
      pool = pool.filter((p) => p.id !== chosen.id);
      const owner = guests.find((g) => g.id === chosen.ownerId);
      const price = priceOf({ ...chosen, hasDedication: false }, state.replaySurcharge, state.tokenMode) + (state.tokenMode ? 1 : 0);
      const chargedTokens = owner ? Math.min(price, owner.tokenBalance) : 0;
      if (owner) owner.tokenBalance -= chargedTokens;
      onDeck.push({ itemId: chosen.id, ownerId: chosen.ownerId, isMystery: true, isHousePick: false, chargedTokens });
      // ±1 jitter (§7) without a second persisted field: starting the count at -1/0/1 instead of always
      // 0 delays or advances the next trigger by exactly one normal slot, for free.
      const jitterRoll = rng();
      mysteryCounter = jitterRoll < 1 / 3 ? -1 : jitterRoll < 2 / 3 ? 0 : 1;
      continue;
    }

    const eligible = guests.filter((g) => g.active && g.queue.length > 0);
    clampTurnCredit(eligible);

    const sorted = [...eligible].sort((a, b) => {
      if (b.credit !== a.credit) return b.credit - a.credit;
      const aLast = a.lastTurnAt ?? -Infinity;
      const bLast = b.lastTurnAt ?? -Infinity;
      if (aLast !== bLast) return aLast - bLast;
      return a.joinedAt - b.joinedAt;
    });

    const take = (g: RotationGuest, onHouse: boolean) => {
      const song = g.queue[0];
      const price = priceOf(song, state.replaySurcharge, state.tokenMode);
      const chargedTokens = onHouse ? 0 : Math.min(price, g.tokenBalance);
      g.tokenBalance -= chargedTokens;
      g.queue = g.queue.slice(1);
      g.credit -= turnCost(g.weight);
      g.lastTurnAt = now;
      onDeck.push({ itemId: song.id, ownerId: g.id, isMystery: false, isHousePick: false, chargedTokens });
    };

    let placed = false;
    const skippedThisSlot: TurnSkippedNotification[] = [];
    for (const g of sorted) {
      const price = priceOf(g.queue[0], state.replaySurcharge, state.tokenMode);
      if (g.tokenBalance >= price || state.onHouseDefault) {
        take(g, false);
        placed = true;
        break;
      }
      skippedThisSlot.push({ guestId: g.id, reason: "turn_skipped", tokensNeeded: price - g.tokenBalance });
    }
    if (!placed) {
      let house: DraftedSong | null = null;
      try {
        house = state.housePick();
      } catch (err) {
        // No house music (no fallback playlist, or it's used up). Keep what's been drafted so far
        // rather than throwing it all away. And if on deck would be empty, the guest whose turn it is
        // plays on the house: tokens are only earned as songs finish, so a silent room is one nobody
        // could ever earn their way out of.
        // No "turn skipped" toasts here: nothing took this slot from anyone, it's just left open.
        if (onDeck.length > 0) break;
        if (sorted.length === 0) throw err;
        take(sorted[0], true);
        notifications.push(...skippedThisSlot.filter((n) => n.guestId !== sorted[0].id));
        mysteryCounter += 1;
        continue;
      }
      onDeck.push(house);
    }
    notifications.push(...skippedThisSlot);
    mysteryCounter += 1;
  }

  return { onDeck, guests, pool, mysteryCounter, notifications, yieldedHousePicks };
}

// ---- Crowd pick (§6, D5, D12, D14) — the alternative to rotation order. openBallot()/closeBallot()
// never call draft(), and draft() never runs while a room is in this mode (§5.4's `break`). ----

export interface CrowdPickGuest extends RotationGuest {
  /** Consecutive ballot rounds this guest's candidate has lost without winning — resets to 0 on a win.
   * Only counts rounds it was actually ON the ballot; not making the ballot at all doesn't count. */
  lostRounds: number;
}

export interface BallotCandidate {
  itemId: string;
  ownerId: string;
  isMystery: boolean;
  /** epoch ms this guest's candidate has effectively been "waiting" — their last turn, or when they
   * joined if they've never had one. Only ever shown to guests when the room's wait-time toggle is on
   * (D14) — this type carries it either way; the UI/broadcast layer decides whether to include it. */
  waitingSince: number;
  /** True once lostRounds >= wildcardAfter — flagged on the ballot; forced to win if it loses again. */
  isWildcard: boolean;
  /** Rounds this song has lost in a row — "waited 2 rounds" when the room shows wait time (D14). */
  lostRounds: number;
}

export interface OpenBallotResult {
  guests: CrowdPickGuest[];
  ballot: BallotCandidate[];
}

/** Called once per round, when the ballot opens. Admission is rotation order's own ranking (D12): the
 * highest credit (fewest turns for your weight, with the same catch-up clamp as draft()) gets on, ties to
 * whoever waited longest. Credit only moves when a song is actually drafted (closeBallot), exactly as in
 * draft(), so the two "Next song" methods can't drift apart. `guests` comes back as an unchanged copy. */
export function openBallot(guests: CrowdPickGuest[], ballotSize: number, wildcardAfter: number): OpenBallotResult {
  const next = guests.map((g) => ({ ...g, queue: [...g.queue] }));
  const eligible = next.filter((g) => g.active && g.queue.length > 0).map((g) => ({ ...g }));
  clampTurnCredit(eligible);

  const sorted = [...eligible].sort((a, b) => {
    if (b.credit !== a.credit) return b.credit - a.credit;
    const aLast = a.lastTurnAt ?? -Infinity;
    const bLast = b.lastTurnAt ?? -Infinity;
    if (aLast !== bLast) return aLast - bLast;
    return a.joinedAt - b.joinedAt;
  });

  const ballot: BallotCandidate[] = sorted.slice(0, Math.max(0, ballotSize)).map((g) => ({
    itemId: g.queue[0].id,
    ownerId: g.id,
    isMystery: false,
    waitingSince: g.lastTurnAt ?? g.joinedAt,
    isWildcard: g.lostRounds >= wildcardAfter,
    lostRounds: g.lostRounds,
  }));

  return { guests: next, ballot };
}

export interface CloseBallotResult {
  winnerItemId: string;
  guests: CrowdPickGuest[];
}

/**
 * The vote is over. Ties go to whoever's waited longest; no votes at all falls back to rotation order
 * (highest credit). A flagged wildcard that would lose again is forced to win instead — the one case
 * votes don't decide the outcome. Self-votes are just votes; nothing here treats them differently.
 */
export function closeBallot(
  ballot: BallotCandidate[],
  votes: Record<string, string>,
  guests: CrowdPickGuest[],
  now = Date.now(),
): CloseBallotResult {
  const tally = new Map<string, number>(ballot.map((c) => [c.itemId, 0]));
  for (const itemId of Object.values(votes)) {
    if (tally.has(itemId)) tally.set(itemId, (tally.get(itemId) ?? 0) + 1);
  }

  const maxVotes = Math.max(0, ...tally.values());
  let winner: BallotCandidate;
  if (maxVotes > 0) {
    // Ties go to whoever's waited longest; only meaningful among the actual top-voted candidates.
    const topVoted = ballot.filter((c) => tally.get(c.itemId) === maxVotes);
    winner = [...topVoted].sort((a, b) => a.waitingSince - b.waitingSince)[0];
  } else {
    // No votes at all: rotation order decides, by credit — waiting time doesn't apply here.
    // Rotation order decides: the ballot is already in that order (openBallot), mystery songs last.
    winner = [...ballot].sort((a, b) => Number(a.isMystery) - Number(b.isMystery))[0];
  }

  // A wildcard that would lose again plays anyway; with several, the one that's waited longest.
  const forcedWildcard = ballot
    .filter((c) => c.isWildcard && c.itemId !== winner.itemId)
    .sort((a, b) => b.lostRounds - a.lostRounds || a.waitingSince - b.waitingSince)[0];
  if (forcedWildcard && !winner.isWildcard) winner = forcedWildcard;

  const nextGuests = guests.map((g) => {
    const onBallot = ballot.some((c) => c.ownerId === g.id && !c.isMystery);
    if (!onBallot) return g;
    if (g.id === winner.ownerId && !winner.isMystery) {
      // A turn costs what it costs in draft(): 1/weight. Mystery wins sit outside the rotation (§7).
      return { ...g, credit: g.credit - turnCost(g.weight), lastTurnAt: now, lostRounds: 0, queue: g.queue.slice(1) };
    }
    return { ...g, lostRounds: g.lostRounds + 1 };
  });

  return { winnerItemId: winner.itemId, guests: nextGuests };
}

export interface UpcomingSlot {
  kind: "guest" | "mystery" | "house";
  /** The song for a guest slot; null for mystery and house slots. */
  itemId: string | null;
  ownerId: string | null;
}

/**
 * The main queue's forecast: runs draft() forward `count` slots past on deck on a scratch copy, so it
 * follows the real rules (turn order, weights, who can pay, mystery slots) and changes whenever a
 * personal queue does. Stops at the first house pick: past that point nobody has a song to forecast.
 */
export function projectUpcoming(state: DraftRoomState, count: number): UpcomingSlot[] {
  if (count <= 0) return [];
  const onDeck = state.onDeck.map((o) => ({ ...o, canYield: false }));
  let houseN = 0;
  const result = draft({
    ...state,
    onDeck,
    onDeckSize: onDeck.length + count,
    housePick: () => ({ itemId: `house-${houseN++}`, ownerId: null, isMystery: false, isHousePick: true, chargedTokens: 0 }),
    // Fixed, so the forecast doesn't reshuffle on every broadcast.
    rng: () => 0.5,
  });
  const slots: UpcomingSlot[] = [];
  for (const d of result.onDeck.slice(onDeck.length)) {
    if (d.isHousePick) {
      slots.push({ kind: "house", itemId: null, ownerId: null });
      break;
    }
    slots.push(d.isMystery ? { kind: "mystery", itemId: null, ownerId: null } : { kind: "guest", itemId: d.itemId, ownerId: d.ownerId });
  }
  return slots;
}
