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
  /** Up for a fight (Fight for a spot): out of the rotation until it wins or comes back. */
  inFight?: boolean;
}

/** One on-deck slot, everyone's view. */
export interface OnDeckItemView {
  id: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  albumName?: string | null;
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
  kind: "guest" | "mystery" | "house" | "host";
  guestId: string | null;
  addedBy: { nickname: string; emoji: string } | null;
  /** The song itself, for guest slots, when the room shows what's coming up (showUpcomingSongs). Never
   * for mystery slots. */
  trackName?: string | null;
  artistName?: string | null;
  albumArtUrl?: string | null;
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

/** A host song pinned to a slot in Coming up (dragged there on the host board). */
export interface HostPinnedSongView extends HostPoolSongView {
  /** Its slot in Coming up (0 = the next one drafted). */
  slot: number;
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
  /** The host's own songs waiting for a house pick (Rotation mode host adds), in order. */
  house: HostPoolSongView[];
  /** The host's songs pinned to a slot in Coming up. */
  pinned: HostPinnedSongView[];
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
 * Rotation order's fairness rule (§8): turns come in **rounds**. A round is every ×1 guest once; a guest's
 * weight is how many turns they get per round (×2 = two, ×1.5 = one then two, ×0.5 = every other round).
 * `credit` is the turns a guest has left in the current round (whole turns plus a carried fraction).
 *
 * - A new round starts when no guest with songs has a whole turn left: everyone active gets their weight
 *   added to the fraction they carried. Unused whole turns don't carry (an empty or broke guest can't
 *   bank a backlog), but a debt does (a host draft took a turn they didn't have yet).
 * - Inside a round, turn order is whoever waited longest. A boosted guest's extra turns are either played
 *   back to back with their normal one (`together`, the default) or spaced out (`spread`).
 * - A guest joining mid-party starts with no turns left this round: the end of the line.
 * - The host changing a weight adds the difference to this round straight away (setGuestWeight), so the
 *   main queue reshapes the moment it changes.
 *
 * This replaced a credit model where a turn cost 1/weight and the most-owed guest went next: the long-run
 * rate was right, but a weight change barely moved the next ten songs and ×3 could come out as four turns
 * in a row.
 */
export type BoostedTurns = "together" | "spread";

const WHOLE_TURN = 1 - 1e-9;

/**
 * A host weight change, applied to this round (§8): the difference in turns per round is added to the
 * turns left, so the main queue reshapes at once. A raise that gives them a turn now puts it next (their
 * wait is treated as the longest), which is what the host expects to see. Lowering a weight never takes
 * them below zero turns, or deeper into a debt they already had.
 */
export function applyWeightChange<T extends { weight: number; credit: number; lastTurnAt: number | null }>(
  g: T,
  weight: number,
): Pick<T, "weight" | "credit" | "lastTurnAt"> {
  const delta = weight - g.weight;
  if (delta < 0) return { weight, credit: Math.max(Math.min(g.credit, 0), g.credit + delta), lastTurnAt: g.lastTurnAt };
  const credit = g.credit + delta;
  const gainsTurnNow = g.credit < WHOLE_TURN && credit >= WHOLE_TURN;
  return { weight, credit, lastTurnAt: gainsTurnNow ? -1 : g.lastTurnAt };
}

/** Starts a new round for these guests (mutates). */
export function startRound<T extends { credit: number; weight: number }>(guests: T[]): void {
  for (const g of guests) g.credit = (g.credit < 0 ? g.credit : g.credit % 1) + g.weight;
}

interface TurnGuest {
  id: string;
  credit: number;
  weight: number;
  lastTurnAt: number | null;
  joinedAt: number;
  active: boolean;
  queue: unknown[];
}

/** Never had a turn counts as waiting since the epoch; a raised weight's extra turn (-1) goes before even that. */
const byLongestWait = (a: TurnGuest, b: TurnGuest) => (a.lastTurnAt ?? 0) - (b.lastTurnAt ?? 0) || a.joinedAt - b.joinedAt;

/** Starts new rounds (mutating `guests`) until a guest with songs has a whole turn left. False when no
 * active guest has songs at all. */
export function ensureRound<T extends TurnGuest>(guests: T[]): boolean {
  const eligible = guests.filter((g) => g.active && g.queue.length > 0);
  if (eligible.length === 0) return false;
  // Weights are at least ×0.5, so two rounds always give someone a whole turn; 4 is just a safe bound.
  for (let i = 0; i < 4 && !eligible.some((g) => g.credit >= WHOLE_TURN); i++) startRound(guests.filter((g) => g.active));
  return true;
}

/**
 * Who goes next, in order of preference (the caller takes the first who can pay), among guests with songs
 * and a whole turn left this round. `freshRound` = a round started since the last turn was taken, so a
 * back-to-back pair never straddles two rounds.
 */
export function turnCandidates<T extends TurnGuest>(guests: T[], mode: BoostedTurns, freshRound: boolean): T[] {
  const owed = guests.filter((g) => g.active && g.queue.length > 0 && g.credit >= WHOLE_TURN).sort(byLongestWait);
  const latest = guests.reduce<T | null>((m, g) => (g.lastTurnAt !== null && (m === null || g.lastTurnAt > (m.lastTurnAt ?? -Infinity)) ? g : m), null);
  if (mode === "together") {
    if (!freshRound && latest && owed.includes(latest)) return [latest, ...owed.filter((g) => g !== latest)];
    return owed;
  }
  // Spread: most turns left first, never the same guest twice running while someone else is owed.
  const sorted = [...owed].sort((a, b) => Math.floor(b.credit + 1e-9) - Math.floor(a.credit + 1e-9) || byLongestWait(a, b));
  if (latest && sorted.length > 1 && sorted[0] === latest) return [...sorted.slice(1), latest];
  return sorted;
}

/** Everyone with songs, in the order their turns come: owed this round first (as turnCandidates), then
 * the rest as the next round would order them. For "how many turns until yours" and Crowd pick's ballot. */
export function rotationOrder<T extends TurnGuest>(guests: T[], mode: BoostedTurns = "together"): T[] {
  const eligible = guests.filter((g) => g.active && g.queue.length > 0);
  const owed = turnCandidates(eligible, mode, false);
  const rest = eligible.filter((g) => !owed.includes(g));
  const nextRound = (g: T) => (g.credit < 0 ? g.credit : g.credit % 1) + g.weight;
  rest.sort((a, b) => nextRound(b) - nextRound(a) || byLongestWait(a, b));
  return [...owed, ...rest];
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
  /** Where a boosted guest's extra turns go in a round (room setting); default back to back. */
  boostedTurns?: BoostedTurns;
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
  const mode = state.boostedTurns ?? "together";
  let placed = 0;
  let fresh = false;
  let stamp = 0;
  while (placed < max) {
    const turn = nextPayableTurn(guests, state, mode, fresh);
    const payer = turn.guest;
    if (!payer) break;
    payer.tokenBalance -= priceOf(payer.queue[0], state.replaySurcharge, state.tokenMode);
    payer.queue = payer.queue.slice(1);
    payer.credit -= 1;
    payer.lastTurnAt = Number.MAX_SAFE_INTEGER - 1000 + stamp++;
    placed++;
  }
  return placed;
}

/**
 * The next guest whose turn it is and who can pay (or everyone, with onHouseDefault), starting a new round
 * when needed. Guests passed over for tokens this round are listed; if nobody owed this round can pay, a
 * new round starts once (the broke guests lose that turn, §5.2 rule 4) and it looks again.
 */
function nextPayableTurn(
  guests: RotationGuest[],
  state: DraftRoomState,
  mode: BoostedTurns,
  freshRound: boolean,
): { guest: RotationGuest; freshRound: boolean; passedOver: TurnSkippedNotification[] } | { guest: null; freshRound: boolean; passedOver: TurnSkippedNotification[]; first: RotationGuest | null } {
  const passedOver: TurnSkippedNotification[] = [];
  let fresh = freshRound;
  let first: RotationGuest | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = guests.map((g) => g.credit);
    if (!ensureRound(guests)) return { guest: null, freshRound: fresh, passedOver, first };
    if (guests.some((g, i) => g.credit !== before[i])) fresh = true;
    const candidates = turnCandidates(guests, mode, fresh);
    first ??= candidates[0] ?? null;
    for (const g of candidates) {
      const price = priceOf(g.queue[0], state.replaySurcharge, state.tokenMode);
      if (state.onHouseDefault || g.tokenBalance >= price) return { guest: g, freshRound: fresh, passedOver };
      if (!passedOver.some((n) => n.guestId === g.id)) passedOver.push({ guestId: g.id, reason: "turn_skipped", tokensNeeded: price - g.tokenBalance });
    }
    // Nobody owed this round can pay: the next round, once.
    if (attempt === 0) {
      startRound(guests.filter((g) => g.active));
      fresh = true;
    }
  }
  return { guest: null, freshRound: fresh, passedOver, first };
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
  const mode = state.boostedTurns ?? "together";
  let freshRound = false;
  let stamp = 0;

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

    const take = (g: RotationGuest, onHouse: boolean) => {
      const song = g.queue[0];
      const price = priceOf(song, state.replaySurcharge, state.tokenMode);
      const chargedTokens = onHouse ? 0 : Math.min(price, g.tokenBalance);
      g.tokenBalance -= chargedTokens;
      g.queue = g.queue.slice(1);
      g.credit -= 1;
      // Strictly increasing within one call, so "who went last" is right for the forecast too.
      g.lastTurnAt = now + stamp++;
      freshRound = false;
      onDeck.push({ itemId: song.id, ownerId: g.id, isMystery: false, isHousePick: false, chargedTokens });
    };

    const turn = nextPayableTurn(guests, state, mode, freshRound);
    freshRound = turn.freshRound;
    const skippedThisSlot = turn.passedOver.filter((n) => n.guestId !== turn.guest?.id);
    if (turn.guest) {
      take(turn.guest, false);
    } else {
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
        const first = "first" in turn ? turn.first : null;
        if (!first) throw err;
        take(first, true);
        notifications.push(...skippedThisSlot.filter((n) => n.guestId !== first.id));
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

/** Called when the ballot opens. Admission is rotation order's own ranking (D12, rotationOrder): guests
 * still owed a turn this round first, so a ×2 guest reaches twice as many ballots. Turns only move when a
 * song is actually drafted (closeBallot), as in draft(). `guests` comes back as an unchanged copy. */
export function openBallot(guests: CrowdPickGuest[], ballotSize: number, wildcardAfter: number): OpenBallotResult {
  const next = guests.map((g) => ({ ...g, queue: [...g.queue] }));
  const ballot: BallotCandidate[] = rotationOrder(next).slice(0, Math.max(0, ballotSize)).map((g) => ({
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
    // Rotation order decides: the ballot is already in that order (openBallot), mystery songs last.
    winner = [...ballot].sort((a, b) => Number(a.isMystery) - Number(b.isMystery))[0];
  }

  // A wildcard that would lose again plays anyway; with several, the one that's waited longest.
  const forcedWildcard = ballot
    .filter((c) => c.isWildcard && c.itemId !== winner.itemId)
    .sort((a, b) => b.lostRounds - a.lostRounds || a.waitingSince - b.waitingSince)[0];
  if (forcedWildcard && !winner.isWildcard) winner = forcedWildcard;

  // The winner uses a turn of this round, exactly as in draft(); a new round starts first if nobody had
  // one left. Mystery wins sit outside the rotation (§7).
  const working = guests.map((g) => ({ ...g, queue: [...g.queue] }));
  if (!winner.isMystery) ensureRound(working);
  const nextGuests = working.map((g) => {
    const onBallot = ballot.some((c) => c.ownerId === g.id && !c.isMystery);
    if (g.id === winner.ownerId && !winner.isMystery) {
      return { ...g, credit: g.credit - 1, lastTurnAt: now, lostRounds: 0, queue: g.queue.slice(1) };
    }
    return onBallot ? { ...g, lostRounds: g.lostRounds + 1 } : g;
  });

  return { winnerItemId: winner.itemId, guests: nextGuests };
}

export interface UpcomingSlot {
  kind: "guest" | "mystery" | "house" | "host";
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
