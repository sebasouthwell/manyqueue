import { useEffect, useRef, useState, type ReactNode } from "react";

const FADE_MS = 800;

/** Fades content out then in whenever `trackKey` changes, instead of snapping. */
export function Crossfade({ trackKey, children }: { trackKey: string; children: ReactNode }) {
  const [visible, setVisible] = useState(true);
  const prevKey = useRef(trackKey);

  useEffect(() => {
    if (prevKey.current === trackKey) return;
    prevKey.current = trackKey;
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), FADE_MS / 2);
    return () => clearTimeout(timer);
  }, [trackKey]);

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS / 2}ms ease`,
      }}
    >
      {children}
    </div>
  );
}
