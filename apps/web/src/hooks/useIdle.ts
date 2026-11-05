import { useEffect, useState } from "react";

/** True after `ms` without mouse movement, touch or a key press; false again on the next one. The TV uses it to
 * hide the cursor (and anything browser-drawn that follows it) while nobody is touching the laptop. */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    arm();
    const events = ["mousemove", "mousedown", "touchstart", "keydown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, arm, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, arm);
    };
  }, [ms]);
  return idle;
}
