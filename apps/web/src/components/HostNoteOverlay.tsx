import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRoomStore } from "../store/roomStore";
import { zalgo } from "./GlitchLayer";

/**
 * The host's secret note (routes/host-notes.ts): the phone's version of the TV's quick overlay. The guest
 * app checks for one when the guest switches tabs, so it shows up on their next visit. "Got it" clears it.
 */
export function HostNoteOverlay({ note, onDone }: { note: string; onDone: () => void }) {
  const glitch = useRoomStore((s) => s.glitchLive?.level ?? s.myGlitch?.level ?? 0);
  return glitch > 0 ? <HackedNote note={note} onDone={onDone} glitch={glitch} /> : <FriendlyNote note={note} onDone={onDone} />;
}

/** Glitch mode's version: a "you've been hacked" terminal, the message typed out line by line. */
function HackedNote({ note, onDone, glitch }: { note: string; onDone: () => void; glitch: number }) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true);
  const [shown, setShown] = useState(0);
  const lines = ["> establishing uplink...", "> bypassing firewall... OK", "> ACCESS GRANTED", ""];
  const header = lines.join("\n");
  const full = header + note;
  useEffect(() => {
    if (shown >= full.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown < header.length ? 18 : 35);
    return () => clearTimeout(t);
  }, [shown, full.length, header.length]);
  const done = shown >= full.length;
  const typed = full.slice(0, shown);

  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-black/95 px-5" data-no-glitch>
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label="A message from the host"
        tabIndex={-1}
        className="relative w-full max-w-sm overflow-hidden rounded-md border border-[#00ff9c]/60 bg-black p-5 font-mono text-[#00ff9c] shadow-[0_0_40px_rgba(0,255,156,0.25)] outline-none"
        style={{ animation: "mq-flicker 3s infinite" }}
      >
        <div className="mq-scanlines pointer-events-none absolute inset-0" style={{ opacity: 0.5 }} aria-hidden />
        <p className="mb-3 text-center text-sm font-bold tracking-[0.25em] text-[#ff3b5c]">
          {done ? zalgo("⚠ SYSTEM BREACH ⚠", Math.min(1, glitch / 150)) : "⚠ SYSTEM BREACH ⚠"}
        </p>
        <p className="min-h-[8rem] whitespace-pre-wrap break-words text-sm leading-relaxed">
          {typed}
          <span className="animate-pulse">█</span>
        </p>
        <p className="mt-3 text-right text-[10px] text-[#00ff9c]/60">— the host</p>
        <button
          onClick={onDone}
          className="mt-4 w-full border border-[#00ff9c]/70 py-2 text-xs font-bold tracking-[0.3em] text-[#00ff9c] hover:bg-[#00ff9c]/10"
        >
          [ ACKNOWLEDGE ]
        </button>
      </div>
    </div>
  );
}

function FriendlyNote({ note, onDone }: { note: string; onDone: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/85 px-6 backdrop-blur-sm">
      <div
        className="pointer-events-none absolute h-72 w-72 rounded-full bg-accent/30 blur-3xl"
        style={{ animation: reduced ? undefined : "mq-glow 3s ease-in-out infinite" }}
        aria-hidden
      />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label="A message from the host"
        tabIndex={-1}
        className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-section p-6 text-center shadow-2xl outline-none ring-1 ring-accent-600"
        style={{ animation: reduced ? undefined : "mq-pop-in 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both" }}
      >
        <span style={{ fontSize: 44 }} aria-hidden>
          💌
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-300">A message from the host</p>
        <p className="whitespace-pre-wrap break-words text-lg text-accent-100">{note}</p>
        <button onClick={onDone} className="mt-1 rounded-full bg-accent px-6 py-2 text-sm font-semibold text-bg">
          Got it
        </button>
      </div>
    </div>
  );
}

/** Checks for a note when the guest switches tabs (not on first load: "next time they do something"),
 * at most every 20 seconds. */
export function useHostNote(code: string, trigger: unknown) {
  const [note, setNote] = useState<string | null>(null);
  const first = useRef(true);
  const lastCheck = useRef(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (note || Date.now() - lastCheck.current < 20_000) return;
    lastCheck.current = Date.now();
    fetch(`/rooms/${code}/me/note`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { note: string | null } | null) => j?.note && setNote(j.note))
      .catch(() => {});
  }, [code, trigger, note]);

  const dismiss = () => {
    const seen = note;
    setNote(null);
    if (seen)
      fetch(`/rooms/${code}/me/note/seen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: seen }),
      }).catch(() => {});
  };
  return { note, dismiss };
}
