import { DotsSixVertical, DotsThree } from "@phosphor-icons/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MineQueueItemView } from "@manyqueue/shared";
import { HatCover } from "./Holiday";

/** One draggable row in the Mine tab (mockup 4a's dots-six-vertical handle). Only the handle starts a
 * drag — the rest of the row stays tappable (the "…" action sheet, eventually a preview). */
export function SortableMineRow({ item, onOpenActions }: { item: MineQueueItemView; onOpenActions: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 1 : undefined,
        position: "relative",
      }}
      className="flex items-center gap-2 rounded-md bg-section p-2"
    >
      <button
        {...attributes}
        {...listeners}
        className="grid h-8 w-6 shrink-0 touch-none place-items-center text-accent-500"
        aria-label={`Drag to reorder ${item.trackName}`}
      >
        <DotsSixVertical size={18} />
      </button>
      {item.albumArtUrl ? (
        <HatCover trackName={item.trackName} size={44}><img src={item.albumArtUrl} alt="" className="h-11 w-11 rounded" /></HatCover>
      ) : (
        <div className="h-11 w-11 rounded bg-accent-800" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-accent-100">{item.trackName}</p>
        <p className="truncate text-xs text-accent-300">{item.artistName}</p>
        {item.dedication && <p className="truncate text-xs text-accent-400">💌 {item.dedication}</p>}
      </div>
      <button onClick={() => onOpenActions(item.id)} className="shrink-0 text-accent-200" aria-label={`Actions for ${item.trackName}`}>
        <DotsThree size={20} weight="bold" />
      </button>
    </div>
  );
}
