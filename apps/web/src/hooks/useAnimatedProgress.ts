import { useEffect, useRef, useState } from "react";
import type { PlaybackUpdatePayload } from "@manyqueue/shared";

/**
 * Interpolates playback progress between server polls via requestAnimationFrame,
 * so the bar/ring moves smoothly instead of jumping every 3s. `clockOffsetMs` is
 * (serverNow - clientNow), measured via the ping/pong round trip, so
 * clientNow + clockOffsetMs estimates the server's current clock.
 */
export function useAnimatedProgress(
  playback: PlaybackUpdatePayload | null,
  clockOffsetMs: number,
): number {
  const [progressMs, setProgressMs] = useState(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (!playback) {
      setProgressMs(0);
      return;
    }

    function tick() {
      if (!playback) return;
      if (!playback.isPlaying) {
        setProgressMs(playback.progressMs);
        return;
      }
      const estimatedServerNow = Date.now() + clockOffsetMs;
      const elapsed = estimatedServerNow - playback.sampledAt;
      setProgressMs(Math.min(playback.progressMs + elapsed, playback.durationMs));
      frameRef.current = requestAnimationFrame(tick);
    }

    tick();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [playback, clockOffsetMs]);

  return progressMs;
}
