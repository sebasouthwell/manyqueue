import { useEffect, useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";
import { DedicationControl } from "./DedicationControl";

function countdownLabel(msLeft: number): string {
  if (msLeft <= 0) return "0:00";
  const totalSeconds = Math.ceil(msLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PendingApprovalsCard({ code, showEmpty = false }: { code: string; showEmpty?: boolean }) {
  const queue = useRoomStore((s) => s.queue);
  const pending = queue.filter((i) => i.status === "pending");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (pending.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending.length]);

  if (pending.length === 0) {
    if (!showEmpty) return null;
    return (
      <div className="flex w-full flex-col gap-1 rounded-lg bg-panel ring-1 ring-panel-line p-4">
        <p className="text-xs uppercase tracking-wide text-accent-300">Pending approval · 0</p>
        <p className="text-sm text-accent-300">Nothing waiting for approval.</p>
      </div>
    );
  }

  async function respond(itemId: string, action: "approve" | "reject") {
    await fetch(`/rooms/${code}/queue/${itemId}/${action}`, { method: "POST" });
  }

  return (
    <div className={`flex w-full flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4 shadow-[0_0_0_1px_rgb(var(--color-accent-700))] ${showEmpty ? "" : "max-w-sm"}`}>
      <p className="text-xs uppercase tracking-wide text-accent-300">
        Pending approval · {pending.length}
      </p>
      {pending.map((item) => {
        const msLeft = item.approvalLockAt !== null ? item.approvalLockAt - now : null;
        const urgent = msLeft !== null && msLeft <= 30_000;
        return (
          <div key={item.id} className="flex items-center gap-3 rounded-md bg-bg p-2">
            {item.albumArtUrl ? (
              <img src={item.albumArtUrl} alt="" className="h-12 w-12 rounded" />
            ) : (
              <div className="h-12 w-12 rounded bg-accent-800" />
            )}
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm text-accent-100">{item.trackName}</p>
              <p className="flex items-center gap-1 truncate text-xs text-accent-300">
                {item.mystery ? <Emoji value="🕵️" size={12} /> : item.addedBy && <Emoji value={item.addedBy.emoji} size={12} />}
                {item.mystery ? "Mystery pick" : (item.addedBy?.nickname ?? "Someone")}
                {msLeft !== null && (
                  <span className={urgent ? "text-accent-300" : "text-accent-200"}>
                    · auto-approves in {countdownLabel(msLeft)}
                  </span>
                )}
              </p>
              <DedicationControl code={code} item={item} />
            </div>
            <button
              onClick={() => respond(item.id, "approve")}
              className="rounded-full bg-success/20 p-2 text-success"
              aria-label="Approve"
            >
              <Check size={16} weight="bold" />
            </button>
            <button
              onClick={() => respond(item.id, "reject")}
              className="rounded-full bg-danger/20 p-2 text-danger"
              aria-label="Reject"
            >
              <X size={16} weight="bold" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
