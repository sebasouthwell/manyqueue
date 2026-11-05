import { useEffect, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { SOCKET_EVENTS, type ActionLogEntry } from "@manyqueue/shared";
import { getSocket } from "../socket";

export function ActionLogCard({ code, limit = 5 }: { code: string; limit?: number }) {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);

  useEffect(() => {
    fetch(`/rooms/${code}/action-log?limit=${limit}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setEntries(data.entries))
      .catch(() => {});
  }, [code, limit]);

  useEffect(() => {
    const socket = getSocket();
    function onLogged(entry: ActionLogEntry) {
      setEntries((prev) => [entry, ...prev].slice(0, limit));
    }
    socket.on(SOCKET_EVENTS.ACTION_LOGGED, onLogged);
    return () => {
      socket.off(SOCKET_EVENTS.ACTION_LOGGED, onLogged);
    };
  }, [limit]);

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg bg-panel ring-1 ring-panel-line p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent-300">
        <ClockCounterClockwise size={13} /> Activity
      </p>
      {entries.length === 0 && <p className="text-accent-300 text-xs">Nothing yet.</p>}
      {entries.map((e) => (
        <p key={e.id} className="text-xs text-accent-200">
          <span className="tabular-nums text-accent-300">{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
          {" · "}
          {e.label}
        </p>
      ))}
    </div>
  );
}
