import { useEffect, useRef, useState } from "react";
import type { GlitchState, GuestSummary } from "@manyqueue/shared";
import { useFocusTrap } from "../hooks/useFocusTrap";

const DURATIONS: [number | null, string][] = [
  [10, "10s"],
  [30, "30s"],
  [60, "1 min"],
  [300, "5 min"],
  [null, "Until I stop"],
];

const LAST_KEY = "mq-glitch-last";

/** One line for a guest's glitch: off, waiting for their next visit, or running (and for how long). */
export function glitchStatus(g: GlitchState | undefined, now = Date.now()): string {
  if (!g || g.level <= 0) return "glitch: off";
  if (g.armed) return `armed · ${g.level} · waiting for their next visit`;
  if (g.durationSec !== null && g.startedAt !== null) {
    const left = Math.max(0, Math.ceil((g.startedAt + g.durationSec * 1000 - now) / 1000));
    return left > 0 ? `glitching · ${g.level} · ${left}s left` : "glitch: off";
  }
  return `glitching · ${g.level} · until stopped`;
}

/**
 * Glitch mode: set up a glitch for one guest. Remembers their current glitch (and your last settings for
 * someone new). "Next visit" waits for them to open the app or switch screens, then starts 3-7s later;
 * a timed glitch switches itself off at the end.
 */
export function GlitchModal({ code, guest, onClose, onSaved }: { code: string; guest: GuestSummary; onClose: () => void; onSaved: () => void }) {
  const current = guest.glitch && guest.glitch.level > 0 ? guest.glitch : null;
  const last = (() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as { level: number; durationSec: number | null; nextVisit: boolean } | null;
    } catch {
      return null;
    }
  })();
  const [level, setLevel] = useState(current?.level ?? last?.level ?? 60);
  const [durationSec, setDurationSec] = useState<number | null>(current ? current.durationSec : (last?.durationSec ?? 10));
  const [nextVisit, setNextVisit] = useState(current ? current.armed : (last?.nextVisit ?? true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function send(body: { level: number; durationSec: number | null; nextVisit: boolean }) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/rooms/${code}/guests/${guest.id}/glitch`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Couldn't reach their phone. Try again.");
    if (body.level > 0) {
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(body));
      } catch {
        /* fine */
      }
    }
    onSaved();
    onClose();
  }

  const mood = level < 30 ? "fuzzy" : level < 70 ? "spicy" : level < 90 ? "chaos" : level < 100 ? "💀" : "NOW";

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/70 sm:items-center sm:px-6" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Glitch ${guest.nickname}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-t-lg border border-[#00ff9c]/40 bg-black p-5 font-mono text-[#00ff9c] shadow-[0_0_40px_rgba(0,255,156,0.2)] outline-none sm:rounded-lg"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-bold tracking-[0.2em]">🌀 GLITCH {guest.nickname.toUpperCase()}</p>
          <button onClick={onClose} className="text-xs text-[#00ff9c]/70" aria-label="Close">
            [x]
          </button>
        </div>
        <p className="text-[11px] text-[#00ff9c]/70">{glitchStatus(guest.glitch, now)}</p>

        <label className="flex flex-col gap-1 text-xs">
          <span className="flex justify-between">
            <span>level</span>
            <span className="tabular-nums">
              {level} · {mood}
            </span>
          </span>
          <input type="range" min={5} max={100} step={5} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="accent-[#00ff9c]" />
        </label>

        <div className="flex flex-col gap-1 text-xs">
          <span>duration</span>
          <div className="flex flex-wrap gap-1">
            {DURATIONS.map(([sec, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setDurationSec(sec)}
                aria-pressed={durationSec === sec}
                className="rounded border px-2 py-1 text-[11px]"
                style={{
                  borderColor: durationSec === sec ? "#00ff9c" : "rgba(0,255,156,0.3)",
                  background: durationSec === sec ? "rgba(0,255,156,0.15)" : "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="mt-1 flex items-center gap-2 text-[11px]">
            <span>or exactly</span>
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={3600}
              value={durationSec ?? ""}
              placeholder="until stopped"
              onChange={(e) => {
                const v = e.target.value;
                setDurationSec(v === "" ? null : Math.max(1, Math.min(3600, Math.round(Number(v)) || 0)) || null);
              }}
              onBlur={() => durationSec !== null && setDurationSec(Math.max(5, durationSec))}
              className="w-24 rounded border border-[#00ff9c]/40 bg-black px-2 py-1 text-[#00ff9c] outline-none focus:border-[#00ff9c]"
              aria-label="Glitch duration in seconds"
            />
            <span>seconds (5-3600)</span>
          </label>
          {durationSec === null && level < 100 && <span className="text-[10px] text-[#00ff9c]/60">Until you stop it, it starts faint and creeps up over 15 min.</span>}
        </div>

        <label className="flex items-center justify-between gap-3 text-xs">
          <span>
            wait for their next visit
            <span className="block text-[10px] text-[#00ff9c]/60">Starts 3-7s after they open the app or switch screens</span>
          </span>
          <input type="checkbox" checked={nextVisit} onChange={(e) => setNextVisit(e.target.checked)} className="h-4 w-4 accent-[#00ff9c]" />
        </label>

        {error && <p className="text-[11px] text-[#ff3b5c]">{error}</p>}

        <div className="flex gap-2">
          {current && (
            <button
              disabled={busy}
              onClick={() => send({ level: 0, durationSec: null, nextVisit: false })}
              className="flex-1 border border-[#ff3b5c]/70 py-2 text-xs font-bold tracking-[0.2em] text-[#ff3b5c] disabled:opacity-50"
            >
              [ STOP ]
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => send({ level, durationSec, nextVisit })}
            className="flex-1 border border-[#00ff9c]/70 py-2 text-xs font-bold tracking-[0.2em] disabled:opacity-50"
          >
            {current ? "[ UPDATE ]" : "[ GLITCH ]"}
          </button>
        </div>
      </div>
    </div>
  );
}
