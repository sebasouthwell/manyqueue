export interface QueueDiff {
  /** Tracks sitting in Spotify's queue ahead of the one we handed off. */
  foreignAhead: number;
}

/**
 * Compares Spotify's real upcoming queue to what ManyQueue handed off. We only
 * ever queue one track ahead (the `locked` item), so anything in Spotify's
 * queue before that track was queued from the Spotify app directly.
 *
 * Deliberately conservative: with nothing locked, or the locked track absent
 * from Spotify's queue, there's no reliable way to tell a foreign track from
 * autoplay/context filler, so it reports nothing rather than false alarms.
 */
export function diffSpotifyQueue(spotifyQueueUris: string[], lockedUri: string | null): QueueDiff {
  if (!lockedUri) return { foreignAhead: 0 };
  const idx = spotifyQueueUris.indexOf(lockedUri);
  return { foreignAhead: idx > 0 ? idx : 0 };
}

/**
 * How many "next"s land on `uri`, given Spotify's queue listing (GET /me/player/queue, the current song
 * excluded): one per track ahead of it, plus one to leave the current song. Null when it isn't listed.
 * The first copy wins: an earlier copy of the same track is the same song either way.
 */
export function skipsToReach(spotifyQueueUris: string[], uri: string): number | null {
  const idx = spotifyQueueUris.indexOf(uri);
  return idx < 0 ? null : idx + 1;
}
