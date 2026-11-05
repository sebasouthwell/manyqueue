import { useState } from "react";

export function FallbackPlaylistCard({ code, initialSet }: { code: string; initialSet: boolean }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    initialSet ? "saved" : "idle",
  );
  const [trackCount, setTrackCount] = useState<number | null>(null);

  async function save() {
    if (!url.trim()) return;
    setStatus("saving");
    try {
      const res = await fetch(`/rooms/${code}/fallback-playlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistUrl: url.trim() }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      setTrackCount(data.trackCount);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4">
      <p className="text-accent-300 text-xs uppercase tracking-wide">Fallback playlist</p>
      <p className="text-accent-300 text-xs">
        Plays a random pick from here whenever the queue runs dry — no silence.
      </p>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Spotify playlist link"
          className="min-w-0 flex-1 rounded-md bg-bg px-3 py-2 text-sm text-accent-100 outline-none"
        />
        <button
          onClick={save}
          disabled={status === "saving" || !url.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50"
        >
          {status === "saving" ? "…" : "Save"}
        </button>
      </div>
      {status === "saved" && (
        <p className="text-accent-200 text-xs">
          🎲 House picks ready{trackCount !== null ? ` (${trackCount} tracks)` : ""}.
        </p>
      )}
      {status === "error" && (
        <p className="text-danger text-xs">Couldn't load that playlist — check the link.</p>
      )}
    </div>
  );
}
