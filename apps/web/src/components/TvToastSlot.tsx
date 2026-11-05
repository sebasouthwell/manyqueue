import { useEffect, useState } from "react";
import type { QueuedToast } from "@manyqueue/shared";
import { Emoji } from "./Emoji";

const FADE_MS = 300;

/** The single toast pill at the top right — the engine hands it one toast at
 * a time, so this only has to fade whatever it's given in and out. */
export function TvToastSlot({ toast }: { toast: QueuedToast | null }) {
  const [shown, setShown] = useState<QueuedToast | null>(toast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (toast) {
      setShown(toast);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setShown(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!shown) return null;

  return (
    <div
      className="absolute flex items-center gap-3 rounded-full bg-accent-800 px-6 py-2 text-accent-100"
      style={{
        top: 30,
        right: 96,
        zIndex: 60,
        fontSize: 26,
        boxShadow: "0 0 0 1px rgb(var(--color-accent-600))",
        opacity: visible ? 1 : 0,
        transform: `translateY(${visible ? 0 : -10}px)`,
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
      }}
    >
      {shown.emoji && !shown.joins && <Emoji value={shown.emoji} size={30} />}
      {shown.message}
    </div>
  );
}
