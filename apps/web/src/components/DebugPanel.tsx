import { useState } from "react";
import { useRoomStore } from "../store/roomStore";

const KEY = "mq-debug-open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Host-only developer panel. Starts collapsed to a small pill; the choice is remembered. */
export function DebugPanel() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const toasts = useRoomStore((s) => s.toasts);
  const clockOffsetMs = useRoomStore((s) => s.clockOffsetMs);
  const connected = useRoomStore((s) => s.connected);
  const [open, setOpen] = useState(readOpen);

  function toggle() {
    setOpen((was) => {
      try {
        localStorage.setItem(KEY, was ? "0" : "1");
      } catch {
        // storage blocked: the panel just won't remember
      }
      return !was;
    });
  }

  return (
    <div className="fixed bottom-2 left-2 z-50 hidden max-w-sm font-mono text-xs text-white sm:block">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md bg-black/80 px-2.5 py-1 hover:bg-black"
      >
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        Debug {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-1 max-h-[60vh] overflow-auto rounded-md bg-black/80 p-3">
          <p>
            socket: {connected ? "connected" : "disconnected"} · clock offset: {Math.round(clockOffsetMs)}ms
          </p>
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(snapshot, null, 2)}</pre>
          {toasts.length > 0 && (
            <div className="mt-2 border-t border-white/20 pt-2">
              {toasts.map((t) => (
                <p key={t.id}>🔔 {t.message}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
