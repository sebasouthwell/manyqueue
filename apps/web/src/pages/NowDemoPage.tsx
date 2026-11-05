import { useEffect } from "react";
import { NowTab } from "../components/tabs/NowTab";
import { demoItem } from "../lib/demoQueue";
import { useRoomStore } from "../store/roomStore";

const ART =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='300' height='300' fill='#6d5bd0'/><circle cx='220' cy='90' r='42' fill='#f5d76e'/><rect x='40' y='180' width='130' height='28' fill='#fff'/></svg>`,
  );

/** /demo/now — the phone Now tab over a fake playing song. */
export default function NowDemoPage() {
  useEffect(() => {
    const s = useRoomStore.getState();
    s.setQueue([demoItem("demo-1", "Levitating", "Dua Lipa", "playing", 0, { albumArtUrl: ART })]);
    s.setMyPerms(["skip", "playback", "volume"]);
    s.setVolumePercent(40);
    s.setPlayback({ isPlaying: true, trackUri: "spotify:track:demo-1", progressMs: 60_000, durationMs: 200_000, sampledAt: Date.now() });
  }, []);
  return <NowTab code="DEMO" guestId="demo" />;
}
