import { useEffect, useState } from "react";
import { useRoomStore } from "../store/roomStore";

/** Server-clock "now", re-rendering every `intervalMs` while `active`. */
export function useServerNow(active: boolean, intervalMs = 250): number {
  const offset = useRoomStore((s) => s.clockOffsetMs);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    setTick(Date.now());
    if (!active) return;
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return tick + offset;
}
