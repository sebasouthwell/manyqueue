import { useEffect, useRef, useState } from "react";
import { SpeakerHigh, SpeakerLow, SpeakerNone } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";

const SEND_EVERY_MS = 200;

/** A speaker volume slider. It follows the volume Spotify reports, moves
 * smoothly under your finger without being fought by incoming updates, and
 * sends at most one change every 200ms (plus a final one when you let go).
 * Hidden until the speaker has reported a volume. */
export function VolumeSlider({ code }: { code: string }) {
  const reported = useRoomStore((s) => s.volumePercent);
  const [dragging, setDragging] = useState<number | null>(null);
  const lastSent = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (trailing.current) clearTimeout(trailing.current);
  }, []);

  if (reported === null) return null;
  const value = dragging ?? reported;

  function send(percent: number) {
    lastSent.current = Date.now();
    fetch(`/rooms/${code}/playback/volume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ percent }),
    }).catch(() => {});
  }

  function change(percent: number) {
    setDragging(percent);
    const wait = SEND_EVERY_MS - (Date.now() - lastSent.current);
    if (trailing.current) clearTimeout(trailing.current);
    if (wait <= 0) send(percent);
    else trailing.current = setTimeout(() => send(percent), wait);
  }

  const Icon = value === 0 ? SpeakerNone : value < 50 ? SpeakerLow : SpeakerHigh;

  return (
    <div className="flex w-full items-center gap-3 text-accent-200">
      <Icon size={20} aria-hidden="true" className="shrink-0" />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => change(Number(e.target.value))}
        onPointerUp={() => setDragging(null)}
        onKeyUp={() => setDragging(null)}
        onBlur={() => setDragging(null)}
        aria-label="Volume"
        className="h-2 min-w-0 flex-1 cursor-pointer accent-[rgb(var(--color-accent))]"
      />
      <span className="w-9 text-right text-sm tabular-nums">{value}%</span>
    </div>
  );
}
