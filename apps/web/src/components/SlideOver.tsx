import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { useFocusTrap } from "../hooks/useFocusTrap";

/** A detail panel from the right (UI-GUIDE §4.5): sits over the rail, never over
 * main, so the host can keep working while it's open. Escape closes it and
 * focus goes back to whatever opened it. */
export function SlideOver({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      className="fixed bottom-0 right-0 top-0 z-[65] flex w-[min(420px,100vw)] flex-col gap-3 overflow-y-auto bg-section p-5 shadow-2xl outline-none"
      style={{ boxShadow: "-12px 0 40px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(var(--color-accent-700))" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold text-accent-100">{title}</p>
        <button onClick={onClose} aria-label="Close" className="text-accent-300">
          <X size={20} />
        </button>
      </div>
      {children}
    </div>
  );
}
