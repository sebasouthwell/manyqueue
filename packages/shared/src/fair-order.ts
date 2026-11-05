export interface FairOrderItem {
  id: string;
  /** null = house pick — never part of the round-robin, only fills gaps
   * after every guest's songs have been placed. */
  addedBy: string | null;
  /** 1-indexed slot within this same reorderable list, or null. A pinned
   * item never moves; fairOrder places everything else around it. */
  pinnedPosition: number | null;
}

/**
 * Splits the queue by addedBy (each guest's own order preserved), then takes
 * one song per guest in turn — a guest with 5 songs queued doesn't crowd out
 * someone with 1. `recentlyPlayedGuestIds` is most-recent-first; the guest
 * who played most recently takes their turn last, so nobody gets back-to-back
 * turns right after their song just finished. A guest with no songs left
 * simply drops out of the rotation.
 *
 * Pinned items (host drag/up-down) keep their exact slot; everything else is
 * threaded through the remaining slots in order.
 */
export function fairOrder<T extends FairOrderItem>(
  items: T[],
  recentlyPlayedGuestIds: string[],
): T[] {
  const n = items.length;
  if (n === 0) return [];

  const pinned = items.filter((i) => i.pinnedPosition !== null);
  const unpinned = items.filter((i) => i.pinnedPosition === null);

  const guestGroups = new Map<string, T[]>();
  const houseGroup: T[] = [];
  const firstSeenIndex = new Map<string, number>();

  unpinned.forEach((item, idx) => {
    if (item.addedBy === null) {
      houseGroup.push(item);
      return;
    }
    if (!guestGroups.has(item.addedBy)) {
      guestGroups.set(item.addedBy, []);
      firstSeenIndex.set(item.addedBy, idx);
    }
    guestGroups.get(item.addedBy)!.push(item);
  });

  function recencyRank(guestId: string): number {
    const idx = recentlyPlayedGuestIds.indexOf(guestId);
    return idx === -1 ? Number.POSITIVE_INFINITY : idx;
  }

  // Never-played (or least-recently-played) guests go first; the guest who
  // played most recently (lowest recencyRank) goes last. Ties broken by
  // whoever's first song currently sits earliest in the queue.
  const guestIds = [...guestGroups.keys()].sort((a, b) => {
    const diff = recencyRank(b) - recencyRank(a);
    if (diff !== 0) return diff;
    return firstSeenIndex.get(a)! - firstSeenIndex.get(b)!;
  });

  const interleaved: T[] = [];
  const cursors = new Map(guestIds.map((g) => [g, 0]));
  let anyRemaining = true;
  while (anyRemaining) {
    anyRemaining = false;
    for (const guestId of guestIds) {
      const group = guestGroups.get(guestId)!;
      const cursor = cursors.get(guestId)!;
      if (cursor < group.length) {
        interleaved.push(group[cursor]);
        cursors.set(guestId, cursor + 1);
        anyRemaining = true;
      }
    }
  }
  interleaved.push(...houseGroup);

  const result: (T | undefined)[] = new Array(n).fill(undefined);
  for (const item of pinned.slice().sort((a, b) => a.pinnedPosition! - b.pinnedPosition!)) {
    let idx = Math.min(Math.max(item.pinnedPosition! - 1, 0), n - 1);
    while (result[idx] !== undefined) idx = (idx + 1) % n;
    result[idx] = item;
  }

  let cursor = 0;
  for (let idx = 0; idx < n; idx++) {
    if (result[idx] === undefined) result[idx] = interleaved[cursor++];
  }

  return result as T[];
}
