import type { TokenActivityItem, TokenReason } from "@manyqueue/shared";
import { db as defaultDb, type DB } from "./client.js";
import { history } from "./tokens.js";
import { getQueueItemsByIds } from "./queue.js";

const REASON_LABELS: Record<TokenReason, string> = {
  start: "Starting tokens",
  queue_add: "Added",
  replay_surcharge: "Replay surcharge",
  dedication: "Dedication for",
  contest_entry: "Entered in contest",
  anonymous: "Queued anonymously",
  guess_right: "Guessed right",
  stayed_hidden: "Stayed hidden",
  refund_reject: "Refunded",
  refund_expire: "Refunded",
  refund_contest: "Refunded",
  passive: "Earned for staying",
  grant: "Granted by host",
  penalty: "Penalty",
};

/** The guest's token ledger, newest first, with a human label — queue_add,
 * replay_surcharge and the refund reasons resolve their refId (a queue item
 * id) to the track name so the row can read "Added <song>". */
export function getGuestTokenActivity(guestId: string, database: DB = defaultDb): TokenActivityItem[] {
  const events = [...history(guestId, database)].reverse();

  const refIds = [...new Set(events.map((e) => e.refId).filter((x): x is string => !!x))];
  const trackNames = new Map(
    getQueueItemsByIds(refIds, database).map((item) => [item.id, item.trackName]),
  );

  return events.map((e) => {
    const reason = e.reason as TokenReason;
    const trackName = e.refId ? trackNames.get(e.refId) : undefined;
    const label = trackName ? `${REASON_LABELS[reason]} ${trackName}` : REASON_LABELS[reason];
    return {
      id: e.id,
      delta: e.delta,
      reason,
      label,
      createdAt: e.createdAt.getTime(),
    } satisfies TokenActivityItem;
  });
}
