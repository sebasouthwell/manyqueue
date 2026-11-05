import { useState } from "react";
import { Prohibit } from "@phosphor-icons/react";
import { banCooldownLabel } from "@manyqueue/shared";
import { Sheet } from "./Sheet";
import { useRoomStore } from "../store/roomStore";

/** Pick the song to put to a ban vote: the one playing now, or any waiting in the queue. */
export function BanPicker({ code, onClose }: { code: string; onClose: () => void }) {
  const queue = useRoomStore((s) => s.queue);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A locked song is already in Spotify's own queue and can't be pulled back.
  const candidates = queue.filter((i) => i.status === "playing" || i.status === "queued" || i.status === "pending");

  async function call(itemId: string) {
    setBusy(itemId);
    setError(null);
    try {
      const res = await fetch(`/rooms/${code}/ban/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueItemId: itemId }),
      });
      if (res.ok) {
        onClose();
        return;
      }
      const body = await res.json().catch(() => null);
      if (body?.error === "cooldown") setError(banCooldownLabel(body.retryAfterMs ?? 60_000));
      else if (body?.error === "ban_running") setError("A ban vote is already running.");
      else if (body?.error === "game_spacing") setError("Let a song play first: games always have a song in between.");
      else if (body?.error === "already_banned") setError("That song is already banned.");
      else if (body?.error === "muted") setError("You've been muted, so you can't call votes.");
      else setError("Couldn't start the vote. Try again.");
    } catch {
      setError("Couldn't start the vote. Check your connection.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet label="Pick a song to ban" onClose={onClose}>
      <p className="mb-1 text-lg font-semibold text-accent-100">Ban which song?</p>
      <p className="mb-3 text-sm text-accent-300">The room votes for 30 seconds. If it passes, the song is out for the night.</p>
      {error && (
        <p className="mb-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-sm text-accent-300">Nothing playing or queued to ban.</p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto overscroll-contain">
          {candidates.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => call(item.id)}
                disabled={busy !== null}
                className="flex w-full items-center gap-3 rounded-md bg-bg p-2 text-left disabled:opacity-50"
              >
                {item.albumArtUrl ? (
                  <img src={item.albumArtUrl} alt="" className="h-11 w-11 rounded" />
                ) : (
                  <div className="h-11 w-11 rounded bg-accent-800" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-accent-100">{item.trackName}</span>
                  <span className="block truncate text-xs text-accent-300">{item.artistName}</span>
                </span>
                {item.status === "playing" ? (
                  <span className="text-xs font-semibold text-accent-200">Playing</span>
                ) : (
                  <Prohibit size={16} className="text-accent-300" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
