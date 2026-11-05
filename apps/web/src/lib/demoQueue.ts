import type { QueueItemView } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";

export function demoItem(
  id: string,
  name: string,
  artist: string,
  status: QueueItemView["status"],
  n: number,
  extra: Partial<QueueItemView> = {},
): QueueItemView {
  return {
    id,
    trackUri: `spotify:track:${id}`,
    trackName: name,
    artistName: artist,
    albumArtUrl: null,
    durationMs: 200_000,
    position: n,
    status,
    addedBy: { id: `g${n}`, nickname: ["Maya", "Sam", "Jo", "Kit"][n % 4], emoji: "🦋" },
    source: "queue",
    hearts: 0,
    paid: 1,
    playsTonight: 0,
    pinnedPosition: null,
    approvalLockAt: status === "pending" ? Date.now() + 95_000 : null,
    dedication: null,
    dedicationHidden: false,
    mystery: false,
    ...extra,
  };
}

/** A playing song, for the demo pages that have no real room behind them. */
export function seedDemoSong(): void {
  const store = useRoomStore.getState();
  store.setQueue([demoItem("demo-1", "Levitating", "Dua Lipa", "playing", 0)]);
  store.setPlayback({ isPlaying: true, trackUri: "spotify:track:demo-1", progressMs: 30_000, durationMs: 200_000, sampledAt: Date.now() });
}
