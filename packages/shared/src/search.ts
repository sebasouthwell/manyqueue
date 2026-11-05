import type { SongRuleViolation } from "./song-rules.js";

export interface TrackResult {
  uri: string;
  name: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  releaseYear: number | null;
  explicit: boolean;
}

/** A search result with pricing attached — computed fresh per request (never
 * cached alongside the raw track metadata), since it depends on how many
 * times the track has already played in this room tonight. */
export interface PricedTrackResult extends TrackResult {
  price: number;
  playsTonight: number;
  /** Why this room's song rules block adding it, or null if it's allowed. */
  rule: SongRuleViolation | null;
  /** Banned for the night by a ban vote: shown dimmed, can't be added. */
  banned?: boolean;
}

export interface SearchResponse {
  tracks: PricedTrackResult[];
  offset: number;
  limit: number;
  total: number;
}
