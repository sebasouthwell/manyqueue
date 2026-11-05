import { useCallback, useEffect, useRef, useState } from "react";
import {
  SOCKET_EVENTS,
  initialMomentState,
  initialToastState,
  reduceMoments,
  addToast,
  tickToasts,
  type Moment,
  type MomentEndPayload,
  type MomentEvent,
  type MomentState,
  type ToastPayload,
  type ToastState,
} from "@manyqueue/shared";
import { getSocket } from "../socket";
import { useRoomStore } from "../store/roomStore";

const TICK_MS = 200;

/**
 * The TV's moment engine: owns the takeover layer (5) and the toast layer (6).
 * All the queueing rules live in shared's pure reducers; this only wires them
 * to the clock, the socket and the toast stream. Everything runs on server
 * time (local clock + measured offset) so `until` / `deadlineAt` agree with
 * whoever set them.
 */
export function useMomentEngine() {
  const [moments, setMoments] = useState<MomentState>(initialMomentState);
  const [toasts, setToasts] = useState<ToastState>(initialToastState);
  const offsetRef = useRef(0);

  useEffect(() => {
    offsetRef.current = useRoomStore.getState().clockOffsetMs;
    return useRoomStore.subscribe((s) => {
      offsetRef.current = s.clockOffsetMs;
    });
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const dispatchMoment = useCallback(
    (event: MomentEvent) => {
      setMoments((prev) => {
        const next = reduceMoments(prev, event, serverNow());
        // Ticks that change nothing must not re-render the whole TV.
        return next.current === prev.current && next.queue.length === prev.queue.length ? prev : next;
      });
    },
    [serverNow],
  );

  const endMoment = useCallback((id: string) => dispatchMoment({ type: "end", id }), [dispatchMoment]);

  const pushMoment = useCallback((moment: Moment) => dispatchMoment({ type: "show", moment }), [dispatchMoment]);

  const pushToast = useCallback(
    (toast: ToastPayload) =>
      setToasts((prev) =>
        addToast(
          prev,
          {
            id: toast.id,
            message: toast.message,
            emoji: toast.emoji,
            joins: toast.join ? [toast.join] : undefined,
          },
          serverNow(),
        ),
      ),
    [serverNow],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      dispatchMoment({ type: "tick" });
      setToasts((prev) => {
        const next = tickToasts(prev, serverNow());
        return next.current === prev.current && next.queue.length === prev.queue.length ? prev : next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [dispatchMoment, serverNow]);

  useEffect(() => {
    const socket = getSocket();
    function onShow(moment: Moment) {
      pushMoment(moment);
    }
    function onEnd(payload: MomentEndPayload) {
      dispatchMoment({ type: "end", id: payload.id });
    }
    socket.on(SOCKET_EVENTS.MOMENT_SHOW, onShow);
    socket.on(SOCKET_EVENTS.MOMENT_END, onEnd);
    return () => {
      socket.off(SOCKET_EVENTS.MOMENT_SHOW, onShow);
      socket.off(SOCKET_EVENTS.MOMENT_END, onEnd);
    };
  }, [pushMoment, dispatchMoment]);

  // Toasts come from the store one set() at a time, so diffing each update
  // catches a burst that a render-time "latest only" effect would drop.
  useEffect(() => {
    return useRoomStore.subscribe((state, prev) => {
      if (state.toasts === prev.toasts) return;
      const seen = new Set(prev.toasts.map((t) => t.id));
      for (const t of state.toasts) if (!seen.has(t.id)) pushToast(t);
    });
  }, [pushToast]);

  return {
    takeover: moments.current?.moment ?? null,
    toast: toasts.current?.toast ?? null,
    pushMoment,
    endMoment,
    pushToast,
    serverNow,
  };
}
