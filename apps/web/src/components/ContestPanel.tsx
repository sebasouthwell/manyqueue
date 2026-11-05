import { useState } from "react";
import { Check } from "@phosphor-icons/react";
import type { ContestPoolPayload } from "@manyqueue/shared";
import { SlideOver } from "./SlideOver";
import { Emoji } from "./Emoji";

/** Pick the two entrants by hand, instead of the two oldest. */
export function ContestPanel({ code, pool, onClose }: { code: string; pool: ContestPoolPayload; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setError(null);
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : prev.length >= 2 ? [prev[1], id] : [...prev, id]));
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/rooms/${code}/contest/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: picked }),
      });
      if (res.ok) {
        onClose();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.message ?? "Couldn't start the contest.");
    } catch {
      setError("Couldn't start the contest. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver title="Pick two songs" onClose={onClose}>
      <p className="text-sm text-accent-300">Choose two songs from two different guests to go head to head.</p>
      {pool.entries.length === 0 && <p className="text-sm text-accent-300">Nothing in the pool yet.</p>}
      <ul className="flex flex-col gap-1.5">
        {pool.entries.map((e) => {
          const on = picked.includes(e.id);
          return (
            <li key={e.id}>
              <button
                onClick={() => toggle(e.id)}
                aria-pressed={on}
                className="flex w-full items-center gap-3 rounded-md bg-bg p-2 text-left"
                style={{ boxShadow: on ? "0 0 0 2px rgb(var(--color-accent))" : "none" }}
              >
                {e.albumArtUrl ? <img src={e.albumArtUrl} alt="" className="h-11 w-11 rounded" /> : <div className="h-11 w-11 rounded bg-accent-800" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-accent-100">{e.trackName}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-accent-300">
                    {e.mystery ? (
                      <>
                        <Emoji value="🕵️" size={12} /> Mystery pick
                      </>
                    ) : e.enteredBy ? (
                      <>
                        <Emoji value={e.enteredBy.emoji} size={12} /> {e.enteredBy.nickname}
                      </>
                    ) : (
                      e.artistName
                    )}
                    {e.losses > 0 && <span> · lost {e.losses}</span>}
                  </span>
                </span>
                {on && <Check size={18} weight="bold" className="text-accent-300" />}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <button
        onClick={start}
        disabled={picked.length !== 2 || busy}
        className="rounded-md bg-accent px-4 py-3 font-semibold text-bg disabled:opacity-40"
      >
        {busy ? "Starting…" : "Start contest"}
      </button>
    </SlideOver>
  );
}
