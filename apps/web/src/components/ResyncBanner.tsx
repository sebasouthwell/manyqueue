import { useEffect, useState } from "react";
import { Warning, ArrowsClockwise } from "@phosphor-icons/react";
import { SOCKET_EVENTS, type QueueWarningPayload } from "@manyqueue/shared";
import { getSocket } from "../socket";

/** Inline (not floating) — a drifted queue must stay visible until it's fixed. */
export function ResyncBanner({ code }: { code: string }) {
  const [foreignAhead, setForeignAhead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();
    function onWarning(p: QueueWarningPayload) {
      setForeignAhead(p.foreignAhead);
    }
    socket.on(SOCKET_EVENTS.QUEUE_WARNING, onWarning);
    return () => {
      socket.off(SOCKET_EVENTS.QUEUE_WARNING, onWarning);
    };
  }, []);

  async function check() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/rooms/${code}/resync`);
      if (!res.ok) {
        setNote("Couldn't reach Spotify — try again.");
        return;
      }
      const data = await res.json();
      setForeignAhead(data.foreignAhead);
      if (data.foreignAhead === 0) setNote("In sync with Spotify.");
    } finally {
      setBusy(false);
    }
  }

  async function fix() {
    setBusy(true);
    try {
      const res = await fetch(`/rooms/${code}/resync/fix`, { method: "POST" });
      if (res.ok) setForeignAhead(0);
      else setNote("Couldn't fix it — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (foreignAhead > 0) {
    return (
      <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-lg bg-danger/15 px-4 py-3 text-left shadow-[0_0_0_1px_rgb(var(--color-danger)/0.5)]">
        <p className="flex items-center gap-2 text-sm text-accent-100">
          <Warning size={18} weight="fill" className="shrink-0 text-danger" />
          Spotify has {foreignAhead} song{foreignAhead === 1 ? "" : "s"} we didn't send.
        </p>
        <button
          onClick={fix}
          disabled={busy}
          className="whitespace-nowrap rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
        >
          {busy ? "Fixing…" : "Skip past them"}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={check}
      disabled={busy}
      className="flex items-center gap-1.5 self-start rounded-full border border-accent-700 px-3 py-1 text-xs text-accent-200 disabled:opacity-50"
    >
      <ArrowsClockwise size={12} /> {busy ? "Checking…" : (note ?? "Resync queue")}
    </button>
  );
}
