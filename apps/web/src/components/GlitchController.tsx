import { useEffect, useRef } from "react";
import type { GlitchState } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";

/**
 * Glitch mode, the guest's side: turns the host's glitch (myGlitch) into what runs on this phone
 * (glitchLive, which GlitchLayer draws).
 * - "Next visit": waits until the guest opens the app or switches screens, then starts 3-7s later.
 * - A timed glitch stops itself at the end and tells the server, so the host sees it as off.
 * - "Until stopped" runs until the host sets it to 0; below 100 it starts faint and creeps up.
 */
export function useGlitchController(code: string, screen: unknown) {
  const state = useRoomStore((s) => s.myGlitch);
  const setMyGlitch = useRoomStore((s) => s.setMyGlitch);
  const setLive = useRoomStore((s) => s.setGlitchLive);
  const firstScreen = useRef(true);
  const visits = useRef(0);
  // Whether a glitch state has been seen yet this visit: one already armed when the app opens counts as
  // the visit; one armed later waits for the next screen switch.
  const sawState = useRef(false);

  const post = (step: "start" | "done") =>
    fetch(`/rooms/${code}/me/glitch/${step}`, { method: "POST" })
      .then((r) => (r.ok ? (r.json() as Promise<GlitchState>) : null))
      .then((s) => s && setMyGlitch(s))
      .catch(() => {});

  // Opening the app counts as a visit.
  useEffect(() => {
    visits.current++;
    fetch(`/rooms/${code}/me/glitch`)
      .then((r) => (r.ok ? (r.json() as Promise<GlitchState>) : null))
      .then((s) => s && setMyGlitch(s))
      .catch(() => {});
  }, [code, setMyGlitch]);

  // So does switching screens, or coming back to the tab.
  const bump = useRef<() => void>(() => {});
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    bump.current();
  }, [screen]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && bump.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!state || state.level <= 0) {
      setLive(null);
      bump.current = () => {};
      return;
    }
    const timers: number[] = [];
    if (state.armed) {
      setLive(null);
      let fired = false;
      const arm = () => {
        if (fired) return;
        fired = true;
        timers.push(window.setTimeout(() => post("start"), 3_000 + Math.random() * 4_000));
      };
      bump.current = arm;
      // Arrived while they were opening the app: that's the visit.
      if (visits.current === 1 && document.visibilityState === "visible" && !sawState.current) arm();
    } else {
      bump.current = () => {};
      const timed = state.durationSec !== null && state.startedAt !== null;
      const endsAt = timed ? state.startedAt! + state.durationSec! * 1000 : null;
      if (endsAt !== null && Date.now() >= endsAt) {
        setLive(null);
        post("done");
      } else {
        // Timed glitches hit straight away; "until stopped" creeps up (except at 100).
        setLive({ level: state.level, instant: timed || state.level >= 100 });
        if (endsAt !== null) {
          timers.push(
            window.setTimeout(() => {
              setLive(null);
              post("done");
            }, endsAt - Date.now()),
          );
        }
      }
    }
    sawState.current = true;
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.level, state?.armed, state?.startedAt, state?.durationSec]);
}
