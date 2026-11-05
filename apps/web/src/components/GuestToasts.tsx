import { useEffect, useState } from "react";
import { Coin } from "@phosphor-icons/react";
import type { ToastPayload } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";

const SMALL_DISPLAY_MS = 3000;
const BIG_DISPLAY_MS = 4000;
const FADE_MS = 250;

function SmallToast({ toast, onDone }: { toast: ToastPayload; onDone: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    const exitTimer = setTimeout(() => setVisible(false), SMALL_DISPLAY_MS);
    const removeTimer = setTimeout(onDone, SMALL_DISPLAY_MS + FADE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg shadow-lg"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -10}px)`,
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
      }}
    >
      {toast.emoji && <Emoji value={toast.emoji} size={16} />}
      {toast.message}
    </div>
  );
}

function BigToast({ toast, onDone }: { toast: ToastPayload; onDone: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    const exitTimer = setTimeout(() => setVisible(false), BIG_DISPLAY_MS);
    const removeTimer = setTimeout(onDone, BIG_DISPLAY_MS + FADE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center px-8"
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "none",
      }}
    >
      <div
        className="flex flex-col items-center gap-2 rounded-2xl bg-accent-700 px-8 py-6 text-center shadow-2xl"
        style={{
          transform: `scale(${visible ? 1 : 0.85})`,
          transition: `transform ${FADE_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
          boxShadow: "0 0 60px rgb(var(--color-accent) / 0.5)",
        }}
      >
        <Coin size={40} weight="fill" className="text-accent-100" />
        <p className="text-xl font-bold text-accent-100">{toast.message}</p>
      </div>
    </div>
  );
}

export function GuestToasts() {
  const toasts = useRoomStore((s) => s.toasts);
  const [shown, setShown] = useState<ToastPayload[]>([]);

  useEffect(() => {
    const latest = toasts[toasts.length - 1];
    if (!latest || !latest.guestVisible) return;
    setShown((prev) => (prev.some((t) => t.id === latest.id) ? prev : [...prev, latest]));
  }, [toasts]);

  const remove = (id: string) => setShown((prev) => prev.filter((t) => t.id !== id));

  return (
    <>
      {shown
        .filter((t) => !t.big)
        .map((t) => (
          <SmallToast key={t.id} toast={t} onDone={() => remove(t.id)} />
        ))}
      {shown
        .filter((t) => t.big)
        .map((t) => (
          <BigToast key={t.id} toast={t} onDone={() => remove(t.id)} />
        ))}
    </>
  );
}
