import { CaretUp, CaretDown, X, PushPin } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";
import { DedicationControl } from "./DedicationControl";
import { HostRotationBoard } from "./HostRotationBoard";

/** `wide`: the desk's Queue section — fills its column and says so when empty. */
export function HostQueueList({ code, wide = false }: { code: string; wide?: boolean }) {
  const queue = useRoomStore((s) => s.queue);
  const mode = useRoomStore((s) => s.settings?.mode ?? "shared");
  const queued = queue.filter((i) => i.status === "queued");

  if (mode === "rotation") {
    return <HostRotationBoard code={code} />;
  }

  async function remove(itemId: string) {
    await fetch(`/rooms/${code}/queue/${itemId}`, { method: "DELETE" });
  }

  async function move(itemId: string, direction: "up" | "down") {
    await fetch(`/rooms/${code}/queue/${itemId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
  }

  if (queued.length === 0) {
    if (!wide) return null;
    return (
      <div className="flex w-full flex-col gap-1 rounded-lg bg-panel ring-1 ring-panel-line p-4">
        <p className="text-xs uppercase tracking-wide text-accent-300">Up next</p>
        <p className="text-sm text-accent-300">The queue is empty.</p>
      </div>
    );
  }

  return (
    <div className={`flex w-full flex-col gap-1 rounded-lg bg-panel ring-1 ring-panel-line p-4 ${wide ? "" : "max-w-sm"}`}>
      <p className="mb-1 text-xs uppercase tracking-wide text-accent-300">Up next</p>
      {queued.map((item, idx) => (
        <div key={item.id} className="flex items-center gap-2 rounded-md bg-bg p-2">
          <div className="min-w-0 flex-1 text-left">
            <p className="flex items-center gap-1.5 truncate text-sm text-accent-100">
              {item.trackName}
              {item.pinnedPosition !== null && (
                <span className="flex items-center gap-0.5 rounded-full bg-accent-700/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-200">
                  <PushPin size={9} weight="fill" /> Pinned
                </span>
              )}
            </p>
            <p className="truncate text-xs text-accent-300">{item.artistName}</p>
            <DedicationControl code={code} item={item} />
          </div>
          <button
            onClick={() => move(item.id, "up")}
            disabled={idx === 0}
            className="text-accent-200 disabled:opacity-30"
          >
            <CaretUp size={16} />
          </button>
          <button
            onClick={() => move(item.id, "down")}
            disabled={idx === queued.length - 1}
            className="text-accent-200 disabled:opacity-30"
          >
            <CaretDown size={16} />
          </button>
          <button onClick={() => remove(item.id)} className="text-danger">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
