export type QueueItemStatus =
  | "pending"
  | "queued"
  | "locked"
  | "playing"
  | "played"
  | "skipped"
  | "contest"
  // Rotation mode (the Rotation-mode design): a guest's own queue, the mystery lane, drafted-and-waiting,
  // and entered in a "fight for a spot" contest.
  | "mine"
  | "pool"
  | "on_deck"
  | "in_fight"
  // A song the host added in Rotation mode, waiting to take the next house pick.
  | "house";
export type QueueItemSource = "queue" | "fallback";

/** A skip this far through the song (or further) is basically the song having played — reaching for the
 * next track right at the end isn't the same as cutting someone off. It's still recorded as a skip (the
 * history, the activity log, a ban all still say so), but stats that judge a song or a guest by their
 * skips — the skip-rate a nickname is built from, the Certified Skip label — don't hold it against them. */
export const SKIP_NEAR_END_PERCENT = 0.8;

/** Whether a skip at this point in the song happened late enough that skip-counting stats should leave it out. */
export function isNearEndSkip(progressMs: number, durationMs: number): boolean {
  return durationMs > 0 && progressMs / durationMs >= SKIP_NEAR_END_PERCENT;
}

export interface QueueItemView {
  id: string;
  trackUri: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  /** When known: lets a Christmas album's songs wear the Santa hat even without "Christmas" in the title. */
  albumName?: string | null;
  durationMs: number;
  position: number;
  status: QueueItemStatus;
  addedBy: { id: string; nickname: string; emoji: string } | null;
  source: QueueItemSource;
  hearts: number;
  paid: number;
  playsTonight: number;
  pinnedPosition: number | null;
  /** ms epoch — when a pending item silently auto-approves. null unless pending. */
  approvalLockAt: number | null;
  /** Shown under the title on phones and on the TV for the first 20s. Null when
   * there is none or the host hid it. */
  dedication: string | null;
  dedicationHidden: boolean;
  /** A mystery pick before its reveal: `addedBy` is always null for these, for everyone. */
  mystery: boolean;
}

/** A song that already played (or was skipped part-way), for the history panel. */
export interface HistoryItemView {
  id: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  status: "played" | "skipped";
  addedBy: { id: string; nickname: string; emoji: string } | null;
  source: QueueItemSource;
  /** ms epoch — when it finished or was skipped. */
  endedAt: number;
  mystery: boolean;
  /** Reactions this song got, most first. Empty until someone reacts. */
  reactions: { emoji: string; count: number }[];
  /** Who reacted the most to it. */
  topReactor: { nickname: string; emoji: string; count: number } | null;
}

export interface AddToQueueResponse {
  status: "added" | "duplicate";
  item: QueueItemView;
}
