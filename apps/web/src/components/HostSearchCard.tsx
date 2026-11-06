import { useEffect, useRef, useState } from "react";
import { Heart } from "@phosphor-icons/react";
import { DEDICATION_MAX_LENGTH, type TrackResult } from "@manyqueue/shared";
import { formatDuration } from "../lib/format";
import { useRoomStore } from "../store/roomStore";

type AddState = { kind: "idle" } | { kind: "adding" } | { kind: "added" } | { kind: "duplicate" };

export function HostSearchCard({ code, wide = false }: { code: string; wide?: boolean }) {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<TrackResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addState, setAddState] = useState<Record<string, AddState>>({});
  const [addError, setAddError] = useState<Record<string, string>>({});
  // Which track's dedication field is open, and what's typed for each — free for the host, no tokens involved.
  const [dedicating, setDedicating] = useState<string | null>(null);
  const [dedications, setDedications] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Rotation mode: the host has no turn of their own, so each add asks where the song goes.
  const rotation = useRoomStore((s) => s.settings?.mode === "rotation");
  const [placing, setPlacing] = useState<TrackResult | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setTracks([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/rooms/${code}/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setTracks(data.tracks);
        }
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, code]);

  async function add(track: TrackResult, placement?: "next" | "house" | "pin") {
    setAddState((prev) => ({ ...prev, [track.uri]: { kind: "adding" } }));
    setAddError((prev) => ({ ...prev, [track.uri]: "" }));
    try {
      const res = await fetch(`/rooms/${code}/queue/host-add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackUri: track.uri,
          name: track.name,
          artistName: track.artistName,
          albumArtUrl: track.albumArtUrl,
          durationMs: track.durationMs,
          dedication: dedications[track.uri]?.trim() || undefined,
          placement,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
        if (body?.error === "dedication_rejected") setAddError((prev) => ({ ...prev, [track.uri]: body.message }));
        if (body?.error === "duplicate") setAddState((prev) => ({ ...prev, [track.uri]: { kind: "duplicate" } }));
        return;
      }
      const data = await res.json();
      setAddState((prev) => ({
        ...prev,
        [track.uri]: { kind: data.status === "duplicate" ? "duplicate" : "added" },
      }));
      setDedicating(null);
    } catch {
      setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
    }
  }

  return (
    <div className={`flex w-full flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4 ${wide ? "" : "max-w-sm"}`}>
      <p className="text-xs uppercase tracking-wide text-accent-300">Add a song yourself</p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a song…"
        className="rounded-full bg-bg px-4 py-2 text-sm text-accent-100 outline-none"
      />
      {loading && <p className="text-accent-300 text-xs">Searching…</p>}
      <div className="flex flex-col gap-1">
        {tracks.map((track) => {
          const state = addState[track.uri] ?? { kind: "idle" };
          const dedicationText = dedications[track.uri] ?? "";
          const open = dedicating === track.uri;
          return (
            <div key={track.uri} className="flex flex-col gap-1.5 rounded-md bg-bg p-2">
              <div className="flex items-center gap-2">
                {track.albumArtUrl ? (
                  <img src={track.albumArtUrl} alt="" className="h-10 w-10 rounded" />
                ) : (
                  <div className="h-10 w-10 rounded bg-accent-800" />
                )}
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm text-accent-100">{track.name}</p>
                  <p className="truncate text-xs text-accent-300">{track.artistName}</p>
                </div>
                <span className="text-accent-300 text-[10px] tabular-nums">{formatDuration(track.durationMs)}</span>
                <button
                  type="button"
                  onClick={() => setDedicating(open ? null : track.uri)}
                  aria-label={dedicationText ? "Edit dedication" : "Add a dedication (free)"}
                  aria-pressed={open || !!dedicationText}
                  className="rounded-full p-1.5"
                  style={{ color: dedicationText ? "rgb(var(--color-accent-300))" : "rgb(var(--color-accent-700))" }}
                >
                  <Heart size={15} weight={dedicationText ? "fill" : "regular"} />
                </button>
                <button
                  onClick={() => (rotation ? setPlacing(track) : add(track))}
                  disabled={state.kind !== "idle"}
                  className="whitespace-nowrap rounded-full border border-accent px-2.5 py-1 text-[11px] text-accent-100 disabled:opacity-60"
                >
                  {state.kind === "idle" && "Add"}
                  {state.kind === "adding" && "…"}
                  {state.kind === "added" && "✓ Added"}
                  {state.kind === "duplicate" && "In queue"}
                </button>
              </div>
              {open && (
                <div className="flex items-center gap-2 pl-12">
                  <input
                    autoFocus
                    value={dedicationText}
                    onChange={(e) => setDedications((prev) => ({ ...prev, [track.uri]: e.target.value.slice(0, DEDICATION_MAX_LENGTH) }))}
                    placeholder="For Sam 🎂 — free, no tokens"
                    className="min-w-0 flex-1 rounded-full bg-panel px-3 py-1.5 text-xs text-accent-100 outline-none"
                  />
                  <span className="shrink-0 text-[10px] tabular-nums text-accent-300">
                    {dedicationText.length}/{DEDICATION_MAX_LENGTH}
                  </span>
                </div>
              )}
              {addError[track.uri] && <p className="pl-12 text-[11px] text-danger">{addError[track.uri]}</p>}
            </div>
          );
        })}
      </div>
      {placing && (
        <PlacementModal
          track={placing}
          onPick={(placement) => {
            void add(placing, placement);
            setPlacing(null);
          }}
          onClose={() => setPlacing(null)}
        />
      )}
    </div>
  );
}

/** Rotation mode: where the host's song goes. Play next skips everyone's turn; a house pick waits for
 * the next slot nobody has a song for, and plays before the fallback playlist. */
function PlacementModal({ track, onPick, onClose }: { track: TrackResult; onPick: (p: "next" | "house" | "pin") => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center sm:px-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Where should this song go?"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-t-lg bg-panel p-5 ring-1 ring-panel-line sm:rounded-lg"
      >
        <div className="flex items-center gap-3">
          {track.albumArtUrl ? <img src={track.albumArtUrl} alt="" className="h-12 w-12 rounded" /> : <div className="h-12 w-12 rounded bg-accent-800" />}
          <div className="min-w-0 text-left">
            <p className="truncate text-sm font-semibold text-accent-100">{track.name}</p>
            <p className="truncate text-xs text-accent-300">{track.artistName}</p>
          </div>
        </div>
        <button onClick={() => onPick("next")} className="flex flex-col items-start rounded-md border border-accent px-4 py-3 text-left">
          <span className="text-sm font-semibold text-accent-100">⏭ Play next</span>
          <span className="text-xs text-accent-300">Skips the queue: plays straight after the current song.</span>
        </button>
        <button onClick={() => onPick("house")} className="flex flex-col items-start rounded-md border border-panel-line px-4 py-3 text-left">
          <span className="text-sm font-semibold text-accent-100">🏠 Next house pick</span>
          <span className="text-xs text-accent-300">Plays when nobody has a song waiting, before the fallback playlist. Guests keep their turns.</span>
        </button>
        <button onClick={() => onPick("pin")} className="flex flex-col items-start rounded-md border border-panel-line px-4 py-3 text-left">
          <span className="text-sm font-semibold text-accent-100">📍 Place in Coming up</span>
          <span className="text-xs text-accent-300">Goes at the end of Coming up; drag it to any slot between guests' songs on the Queues board. It stays put while they reorder.</span>
        </button>
        <button onClick={onClose} className="py-1 text-xs text-accent-300">
          Cancel
        </button>
      </div>
    </div>
  );
}
