import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useReducedMotion } from "../../hooks/useReducedMotion";

const SWIPE_CLOSE_PX = 90;
const SWIPE_CLOSE_VELOCITY = 0.6; // px per ms

interface Props {
  label: string;
  zIndex: number;
  /** Covered by a higher layer: kept mounted (state survives) but invisible. */
  hidden?: boolean;
  /** This frame owns focus and Escape right now. */
  active: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** The bottom-sheet chrome shared by action sheets and the vote sheet: slide
 * up (or just fade with reduced motion), tap the backdrop or swipe the
 * handle down to close, and keep focus inside while it's on top. */
export function SheetFrame({ label, zIndex, hidden = false, active, onClose, children }: Props) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragRef = useRef<{ startY: number; startT: number; pointerId: number } | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useFocusTrap(panelRef, active && !hidden);

  const shown = entered && !hidden;
  const dragging = dragRef.current !== null;

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { startY: e.clientY, startT: e.timeStamp, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    setDrag(Math.max(0, e.clientY - dragRef.current.startY));
  }
  function endDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const dy = e.clientY - d.startY;
    const velocity = dy / Math.max(1, e.timeStamp - d.startT);
    setDrag(0);
    if (dy > SWIPE_CLOSE_PX || velocity > SWIPE_CLOSE_VELOCITY) onClose();
  }

  const ms = reduced ? 180 : 240;
  const vis = `visibility 0s linear ${hidden ? ms : 0}ms`;
  const transition = reduced
    ? `opacity 180ms ease, ${vis}`
    : dragging
      ? "none"
      : `transform 240ms cubic-bezier(0.32, 0.72, 0, 1), opacity 180ms ease, ${vis}`;

  return (
    <div
      className="fixed inset-0 flex items-end justify-center"
      style={{ zIndex, pointerEvents: shown ? "auto" : "none" }}
      aria-hidden={hidden || undefined}
    >
      <div
        className="absolute inset-0 bg-bg/70"
        onClick={onClose}
        style={{ opacity: shown ? 1 : 0, transition: `opacity 180ms ease, visibility 0s linear ${hidden ? 180 : 0}ms`, visibility: hidden ? "hidden" : "visible" }}
        data-testid="sheet-backdrop"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-sheet bg-section pb-8 shadow-2xl outline-none"
        style={{
          opacity: shown ? 1 : 0,
          transform: reduced ? undefined : `translateY(${shown ? drag : 100}${shown && drag ? "px" : "%"})`,
          transition,
          visibility: hidden ? "hidden" : "visible",
        }}
      >
        <div
          className="flex h-8 cursor-grab touch-none items-center justify-center"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="h-1 w-10 rounded-full bg-accent-700" />
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>
  );
}
