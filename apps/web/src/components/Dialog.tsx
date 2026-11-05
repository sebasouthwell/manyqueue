import { useRef, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetLayer } from "./sheets/SheetManager";

interface DialogProps {
  title: string;
  body: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Centered modal — for the rare moments a guest needs to actively decide
 * something (price changes, money). Top of the phone layer stack: it sits
 * over votes and action sheets. Escape takes the secondary choice (or does
 * nothing when there isn't one); the backdrop deliberately does nothing. */
export function Dialog({ title, body, primaryLabel, onPrimary, secondaryLabel, onSecondary }: DialogProps) {
  const { isTop } = useSheetLayer("dialog", secondaryLabel ? onSecondary : undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isTop);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-bg/70 px-6">
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex w-full max-w-xs flex-col gap-4 rounded-lg bg-section p-5 text-center shadow-2xl outline-none"
      >
        <p className="text-lg font-semibold text-accent-100">{title}</p>
        <div className="text-sm text-accent-200">{body}</div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onPrimary}
            className="rounded-md bg-accent px-4 py-3 font-semibold text-bg"
          >
            {primaryLabel}
          </button>
          {secondaryLabel && (
            <button onClick={onSecondary} className="rounded-md px-4 py-2 text-sm text-accent-300">
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
