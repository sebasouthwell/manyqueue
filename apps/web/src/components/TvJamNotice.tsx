import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";

/** TV-only strip (pixel sizes, like the rest of the TV stage) shown while Spotify has
 * rate-limited the app's playback control: the app can't advance the queue, so the room
 * switches to a Spotify Jam until the block lifts. Reactions keep flying meanwhile. */
export function TvJamNotice() {
  const until = useRoomStore((s) => s.spotifyBlockedUntil);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [until]);

  if (!until || until <= Date.now()) return null;
  const at = new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-6 rounded-2xl bg-danger/15"
      style={{ padding: "22px 32px", marginRight: 400, boxShadow: "0 0 0 2px rgb(var(--color-danger) / 0.55)" }}
      role="status"
    >
      <WarningCircle size={64} weight="fill" className="shrink-0 text-danger" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold text-accent-100" style={{ fontSize: 44, lineHeight: 1.1 }}>
          Spotify needs a breather: switching to Jam until <span className="whitespace-nowrap">{at}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-accent-200" style={{ fontSize: 26 }}>
          Add songs in the Spotify app for now. The <Emoji value="🔥" size={28} /> reactions still work, keep them coming!
        </p>
      </div>
    </div>
  );
}
