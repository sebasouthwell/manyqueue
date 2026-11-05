import { useEffect } from "react";
import type { QueueItemView } from "@manyqueue/shared";
import { HostDesk } from "../components/HostDesk";
import { useRoomStore } from "../store/roomStore";
import { demoItem } from "../lib/demoQueue";

// A cover with an off-centre marker, so rotation is visible in screenshots.
const DEMO_ART =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='#6d5bd0'/><circle cx='150' cy='60' r='28' fill='#f5d76e'/><rect x='30' y='120' width='90' height='20' fill='#fff'/></svg>`,
  );

const mk = (id: string, name: string, artist: string, status: QueueItemView["status"], n: number) =>
  demoItem(id, name, artist, status, n, {
    albumArtUrl: n === 0 ? DEMO_ART : null,
    dedication: n === 0 ? "for Sam 🎂" : n === 3 ? "to everyone who stayed" : null,
  });

/** /demo/host — the real HostDesk over fake queue data, for checking layout
 * without a Spotify login. */
export default function HostDemoPage() {
  useEffect(() => {
    const s = useRoomStore.getState();
    s.setQueue([
      mk("1", "Levitating", "Dua Lipa", "playing", 0),
      mk("2", "Blinding Lights", "The Weeknd", "queued", 1),
      mk("3", "Dance Monkey", "Tones and I", "queued", 2),
      mk("4", "Bad Guy", "Billie Eilish", "pending", 3),
      mk("5", "Watermelon Sugar", "Harry Styles", "pending", 4),
    ]);
    s.setPlayback({ isPlaying: true, trackUri: "spotify:track:1", progressMs: 84_000, durationMs: 200_000, sampledAt: Date.now() });
  }, []);

  return (
    <HostDesk
      room={{ code: "DEMO", name: "Demo party", deviceName: "Living room", fallbackPlaylistUri: null }}
      settings={null}
      ending={false}
      onEndNight={() => {}}
      onOpenTv={() => {}}
      onDevicePicked={() => {}}
    />
  );
}
