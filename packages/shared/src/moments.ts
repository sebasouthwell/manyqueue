/** What a moment is — 1 = contest / ban (most urgent), 2 = reveal, 3 = dedication. */
export type MomentKind = "contest" | "ban" | "guess" | "reveal" | "dedication" | "nickname" | "demo";
export type MomentPriority = 1 | 2 | 3;

export interface Moment<P = unknown> {
  id: string;
  kind: MomentKind;
  priority: MomentPriority;
  payload: P;
  /** A higher-priority moment must wait this long before it can replace this one. */
  minMs: number;
  /** Epoch ms after which the moment is over on its own. */
  until?: number;
}

export interface MomentEndPayload {
  id: string;
}

/** The generic full-stage takeover layout (UI-GUIDE §6.3). Later blocks
 * (contest, ban, guess-who reveal) fill this in; none need their own layout. */
export interface TakeoverChoice {
  id: string;
  label: string;
  sublabel?: string;
  artUrl?: string | null;
  /** Live share of the vote, 0-100. */
  percent?: number;
  /** Who entered it, e.g. "Maya 🦋" — hidden behind "🕵️ Mystery pick" for anonymous songs. */
  byline?: string;
}

export interface TakeoverPayload {
  question: string;
  choices?: TakeoverChoice[];
  /** Epoch ms in server time — drives the 84px countdown. */
  deadlineAt?: number;
  /** One instruction line at the bottom, e.g. "Vote on your phone". */
  instruction?: string;
  /** Once set, the result is showing: the winner grows, the rest fade. */
  winnerChoiceId?: string;
  resultText?: string;
  /** The vote this takeover shows; the TV fills in live percentages from its tally. */
  voteId?: string;
  /** A "VS" between the two choices. */
  vs?: boolean;
  /** A ban vote: the TV draws a yes/no bar with the threshold marker instead of percentages. */
  ban?: { threshold: number; active: number };
  /** Guess Who reveal: the avatar, the answer and a bar per guess. */
  reveal?: {
    name: string;
    emoji: string;
    trackName: string;
    artistName: string;
    guesses: { id: string; name: string; emoji: string; percent: number }[];
    nobodyGuessed: boolean;
  };
  /** AI party nickname announcement: who, and the nickname they were given (it carries its own emoji). */
  nickname?: { name: string; emoji: string; nickname: string; why: string };
  /** Dedication only: play the big splash first (a song change), not just the line (a TV that reconnected). */
  splash?: boolean;
}

export interface MomentState {
  current: { moment: Moment; startedAt: number } | null;
  queue: Moment[];
}

/** Moments arriving within this long of each other are one burst: whatever
 * happened to be processed first hasn't really been seen yet, so a more
 * urgent one may take its place without waiting out min_ms. */
export const BURST_GRACE_MS = 100;

export const initialMomentState: MomentState = { current: null, queue: [] };

export type MomentEvent =
  | { type: "show"; moment: Moment }
  | { type: "end"; id: string }
  | { type: "tick" };

function expired(moment: Moment, now: number): boolean {
  return moment.until !== undefined && moment.until <= now;
}

/** Lowest priority number wins; arrival order breaks ties. */
function bestIndex(queue: Moment[]): number {
  let best = -1;
  queue.forEach((m, i) => {
    if (best === -1 || m.priority < queue[best].priority) best = i;
  });
  return best;
}

function settle(state: MomentState, now: number): MomentState {
  let queue = state.queue.filter((m) => !expired(m, now));
  let current = state.current;
  if (current && expired(current.moment, now)) current = null;

  if (!current) {
    const i = bestIndex(queue);
    if (i !== -1) {
      current = { moment: queue[i], startedAt: now };
      queue = queue.filter((_, j) => j !== i);
    }
    return { current, queue };
  }

  const i = bestIndex(queue);
  if (
    i !== -1 &&
    queue[i].priority < current.moment.priority &&
    (now - current.startedAt >= current.moment.minMs || now - current.startedAt < BURST_GRACE_MS)
  ) {
    const next = queue[i];
    const rest = queue.filter((_, j) => j !== i);
    // The one being replaced isn't lost — it goes back ahead of its own
    // priority group, to finish once the more urgent moment is done.
    const at = rest.findIndex((m) => m.priority >= current!.moment.priority);
    rest.splice(at === -1 ? rest.length : at, 0, current.moment);
    return { current: { moment: next, startedAt: now }, queue: rest };
  }
  return { current, queue };
}

export function reduceMoments(state: MomentState, event: MomentEvent, now: number): MomentState {
  switch (event.type) {
    case "show": {
      const known =
        state.current?.moment.id === event.moment.id ||
        state.queue.some((m) => m.id === event.moment.id);
      if (known) return settle(state, now);
      return settle({ ...state, queue: [...state.queue, event.moment] }, now);
    }
    case "end": {
      const current = state.current?.moment.id === event.id ? null : state.current;
      return settle({ current, queue: state.queue.filter((m) => m.id !== event.id) }, now);
    }
    case "tick":
      return settle(state, now);
  }
}
