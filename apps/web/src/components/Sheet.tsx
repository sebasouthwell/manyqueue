import type { ReactNode } from "react";
import { SheetFrame } from "./sheets/SheetFrame";
import { useSheetLayer } from "./sheets/SheetManager";

interface SheetProps {
  onClose: () => void;
  label?: string;
  children: ReactNode;
}

/** An action sheet (picking, editing, adding — in place, not a new screen).
 * A vote covers it rather than replacing it, so its children keep their state
 * while the vote is up; see SheetManager for the priority rules. */
export function Sheet({ onClose, label = "Sheet", children }: SheetProps) {
  const { hidden, isTop } = useSheetLayer("action", onClose);
  return (
    <SheetFrame label={label} zIndex={60} hidden={hidden} active={isTop} onClose={onClose}>
      {children}
    </SheetFrame>
  );
}
