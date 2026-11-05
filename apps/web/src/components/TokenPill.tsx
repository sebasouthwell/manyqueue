import { useEffect, useRef, useState } from "react";
import { Coin } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";

const TWEEN_MS = 300;

export function TokenPill() {
  const tokenMode = useRoomStore((s) => s.settings?.tokenMode ?? true);
  const balance = useRoomStore((s) => s.tokenBalance);
  const [displayValue, setDisplayValue] = useState(balance ?? 0);
  const [pulsing, setPulsing] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const displayRef = useRef(displayValue);
  displayRef.current = displayValue;

  useEffect(() => {
    if (balance === null || balance === displayRef.current) return;

    setPulsing(true);
    const pulseTimer = setTimeout(() => setPulsing(false), TWEEN_MS);

    const from = displayRef.current;
    const to = balance;
    const start = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    function tick(now: number) {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      setDisplayValue(Math.round(from + (to - from) * t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      clearTimeout(pulseTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const auto = setTimeout(() => setOpen(false), 6000);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(auto);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!tokenMode || balance === null) return null;

  return (
    <div ref={wrapRef} className="fixed right-3 top-3 z-40">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${balance} token${balance === 1 ? "" : "s"}. Tap for details.`}
        className="flex items-center gap-1 rounded-full bg-section px-3 py-1.5 text-sm font-semibold text-accent-100 shadow-lg transition-transform duration-300"
        style={{ transform: pulsing ? "scale(1.12)" : "scale(1)" }}
      >
        <Coin size={16} weight="fill" color="rgb(var(--color-accent-300))" />
        <span className="tabular-nums">{displayValue}</span>
      </button>
      {open && (
        <div
          role="status"
          className="absolute right-0 top-full mt-2 w-60 rounded-lg bg-section p-3 text-left text-sm text-accent-200 shadow-2xl"
          style={{ boxShadow: "0 0 0 1px rgb(var(--color-accent-700)), 0 12px 32px rgb(0 0 0 / 0.4)" }}
        >
          <p className="mb-1 font-semibold text-accent-100">
            You have {balance} token{balance === 1 ? "" : "s"}
          </p>
          These can be used to play songs. You'll gain more throughout the night.
        </div>
      )}
    </div>
  );
}
