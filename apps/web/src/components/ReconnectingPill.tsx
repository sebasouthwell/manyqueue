import { useRoomStore } from "../store/roomStore";

export function ReconnectingPill() {
  const connected = useRoomStore((s) => s.connected);
  const fakeOffline = useRoomStore((s) => s.fakeOffline);
  if (connected && !fakeOffline) return null;

  return (
    <div className="fixed left-1/2 top-3 z-[45] -translate-x-1/2 rounded-full bg-danger px-4 py-1.5 text-sm font-semibold text-bg shadow-lg">
      Reconnecting…
    </div>
  );
}
