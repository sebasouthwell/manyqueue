import { useState } from "react";
import { EnvelopeSimpleOpen, Detective, ArrowLineUp, Trash, Sword } from "@phosphor-icons/react";
import type { MineQueueItemView } from "@manyqueue/shared";
import { Sheet } from "./Sheet";
import { useRoomStore } from "../store/roomStore";

interface Props {
  code: string;
  item: MineQueueItemView;
  onClose: () => void;
}

/** The song action sheet (the Rotation-mode design §11, mockup 4b): dedicate, mystery pool, fight for a spot,
 * move to top, remove. */
export function SongActionSheet({ code, item, onClose }: Props) {
  const mine = useRoomStore((s) => s.mine);
  const tokenMode = useRoomStore((s) => s.settings?.tokenMode ?? true);
  const fightsOn = useRoomStore((s) => s.settings?.mode === "rotation" && s.settings.nextSongMethod === "rotation" && s.settings.fights);
  const alreadyFighting = mine.some((m) => m.inFight);
  const [error, setError] = useState<string | null>(null);
  const [editingDedication, setEditingDedication] = useState(false);
  const [text, setText] = useState(item.dedication ?? "");
  const [busy, setBusy] = useState(false);

  const ordered = mine.filter((m) => !m.inPool && !m.inFight);
  const isTop = ordered[0]?.id === item.id;

  async function saveDedication() {
    setBusy(true);
    try {
      await fetch(`/rooms/${code}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dedication: text.trim() || null }),
      });
    } finally {
      setBusy(false);
      onClose();
    }
  }

  async function toPool() {
    setBusy(true);
    try {
      await fetch(`/rooms/${code}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toPool: true }),
      });
    } finally {
      setBusy(false);
      onClose();
    }
  }

  async function fight() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/rooms/${code}/mine/${item.id}/fight`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (res?.ok) return onClose();
    const j = res ? ((await res.json().catch(() => null)) as { message?: string } | null) : null;
    setError(j?.message ?? "Couldn't enter the fight — try again.");
  }

  async function moveToTop() {
    setBusy(true);
    try {
      const reordered = [item.id, ...ordered.filter((m) => m.id !== item.id).map((m) => m.id)];
      await fetch(`/rooms/${code}/mine/order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: reordered }),
      });
    } finally {
      setBusy(false);
      onClose();
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/rooms/${code}/mine/${item.id}`, { method: "DELETE" });
    } finally {
      setBusy(false);
      onClose();
    }
  }

  if (editingDedication) {
    return (
      <Sheet onClose={onClose} label="Dedicate">
        <div className="flex flex-col gap-3 pb-2">
          <p className="truncate text-lg font-semibold text-accent-100">{item.trackName}</p>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 60))}
            placeholder="for Sam 🎂"
            className="rounded-md bg-bg px-4 py-3 text-accent-100 outline-none"
          />
          <p className="text-xs text-accent-300">
            {tokenMode ? "+1 🪙 when drafted (right away if already on deck)" : "Line on the TV for the first 20s"}
          </p>
          <button
            disabled={busy}
            onClick={saveDedication}
            className="rounded-md bg-accent px-4 py-3 font-semibold text-bg disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} label="Song actions">
      <div className="flex flex-col gap-1 pb-2">
        <p className="truncate text-lg font-semibold text-accent-100">{item.trackName}</p>
        <p className="mb-2 truncate text-sm text-accent-300">{item.artistName}</p>

        <button
          onClick={() => setEditingDedication(true)}
          className="flex items-center gap-3 rounded-md px-2 py-3 text-left"
        >
          <EnvelopeSimpleOpen size={20} className="text-accent-300" />
          <div className="min-w-0 flex-1">
            <p className="text-accent-100">{item.dedication ? "Edit dedication" : "Dedicate"}</p>
            <p className="truncate text-xs text-accent-300">{item.dedication || (tokenMode ? "+1 🪙 when drafted" : "Free")}</p>
          </div>
        </button>

        <button disabled={busy} onClick={toPool} className="flex items-center gap-3 rounded-md px-2 py-3 text-left disabled:opacity-50">
          <Detective size={20} className="text-accent-300" />
          <div className="min-w-0 flex-1">
            <p className="text-accent-100">Send to mystery pool</p>
            <p className="text-xs text-accent-300">Plays in a random mystery slot, never uses your turn</p>
          </div>
          <span className="text-xs text-accent-300">{tokenMode ? "2 🪙" : "Free"}</span>
        </button>

        {fightsOn && (
          <button
            disabled={busy || alreadyFighting}
            onClick={fight}
            className="flex items-center gap-3 rounded-md px-2 py-3 text-left disabled:opacity-40"
          >
            <Sword size={20} className="text-accent-300" />
            <div className="min-w-0 flex-1">
              <p className="text-accent-100">Fight for a spot</p>
              <p className="text-xs text-accent-300">
                {alreadyFighting ? "You already have a song in a fight" : "1-on-1 vote: the winner plays next and you keep your turn"}
              </p>
            </div>
            <span className="text-xs text-accent-300">{tokenMode ? "1 🪙 · back if you win" : "Free"}</span>
          </button>
        )}
        {error && <p className="px-2 text-xs text-accent-200">{error}</p>}

        <button
          disabled={busy || isTop}
          onClick={moveToTop}
          className="flex items-center gap-3 rounded-md px-2 py-3 text-left disabled:opacity-40"
        >
          <ArrowLineUp size={20} className="text-accent-300" />
          <p className="text-accent-100">{isTop ? "Already next from you" : "Move to my top"}</p>
        </button>

        <button disabled={busy} onClick={remove} className="flex items-center gap-3 rounded-md px-2 py-3 text-left text-danger disabled:opacity-50">
          <Trash size={20} />
          <p>Remove</p>
        </button>
      </div>
    </Sheet>
  );
}
