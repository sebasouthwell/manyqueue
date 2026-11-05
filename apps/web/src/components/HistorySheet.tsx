import { Sheet } from "./Sheet";
import { HistoryList } from "./HistoryList";

export function HistorySheet({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <Sheet label="Song history" onClose={onClose}>
      <p className="mb-3 text-lg font-semibold text-accent-100">Played tonight</p>
      <div className="max-h-[60vh] overflow-y-auto overscroll-contain pr-1">
        <HistoryList code={code} />
      </div>
    </Sheet>
  );
}
