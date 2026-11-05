import { getPlaylistTracks, type SearchTrack } from "./spotify.js";

const trackCache = new Map<string, SearchTrack[]>();

/** Accepts open.spotify.com URLs, spotify: URIs, or a bare playlist ID. */
export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();

  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/);
    if (match) return match[1];
  } catch {
    // not a URL
  }

  if (/^[a-zA-Z0-9]{10,}$/.test(trimmed)) return trimmed;

  return null;
}

export async function primeFallbackPlaylist(hostId: string, playlistId: string): Promise<number> {
  const tracks = await getPlaylistTracks(hostId, playlistId);
  trackCache.set(playlistId, tracks);
  return tracks.length;
}

export function pickRandomUnplayedFallbackTrack(
  playlistId: string,
  excludeUris: Set<string>,
  isAllowed: (track: SearchTrack) => boolean = () => true,
): SearchTrack | null {
  const tracks = trackCache.get(playlistId) ?? [];
  const candidates = tracks.filter((t) => !excludeUris.has(t.uri) && isAllowed(t));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
