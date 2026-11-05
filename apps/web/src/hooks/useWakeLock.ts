import { useCallback, useEffect, useRef } from "react";

export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  const request = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      sentinelRef.current = await navigator.wakeLock.request("screen");
    } catch {
      // Not fatal — the TV just won't be kept awake. No device to retry against yet.
    }
  }, []);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && sentinelRef.current) {
        request();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [request]);

  return request;
}
