import { sceneForGenres, type SceneId } from "@manyqueue/shared";
import type { Room } from "./rooms.js";
import { getActiveQueueItems, getPlayingItem } from "./queue.js";
import { getRoomSettings } from "./settings.js";
import { artistKey, getCachedGenres, primaryArtist } from "./genres.js";

/** The genre scene for whatever is playing (from cached tags only), or null for the plain background. */
export function sceneFor(room: Pick<Room, "id">): SceneId | null {
  if (!getRoomSettings(room.id).tvScenes) return null;
  const playing = getPlayingItem(room.id);
  if (!playing) return null;
  const key = artistKey(primaryArtist(playing.artistName));
  return sceneForGenres(getCachedGenres([key]).get(key) ?? []);
}

/** The playing song's artist and the next few queued ones, as tagging keys → names. */
export function artistsComingUp(room: Pick<Room, "id">, ahead = 6): Map<string, string> {
  const out = new Map<string, string>();
  const items = getActiveQueueItems(room.id).filter((i) => i.status === "playing" || i.status === "locked" || i.status === "queued");
  for (const item of items.slice(0, ahead + 1)) {
    const name = primaryArtist(item.artistName);
    out.set(artistKey(name), name);
  }
  return out;
}
