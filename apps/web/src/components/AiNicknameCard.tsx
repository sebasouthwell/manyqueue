import { useEffect, useState } from "react";
import { ArrowsClockwise, Check, EyeSlash, Sparkle } from "@phosphor-icons/react";
import { AI_AUTO_SHOW_MS } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";
import { Emoji, EmojiText } from "./Emoji";

async function post(path: string): Promise<boolean> {
  const res = await fetch(path, { method: "POST" });
  return res.ok;
}

/** The host's view of the AI nicknames: new ones wait here for Approve/Hide (and show themselves after 60s),
 * and shown ones can be re-rolled or hidden. Renders nothing without an AI key, when the feature is off,
 * or when nobody has a nickname yet. */
export function AiNicknameCard({ code }: { code: string }) {
  const available = useRoomStore((s) => s.aiNicknamesAvailable);
  const mode = useRoomStore((s) => s.settings?.aiNicknames);
  const list = useRoomStore((s) => s.aiNicknames);
  const setList = useRoomStore((s) => s.setAiNicknames);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    fetch(`/rooms/${code}/ai-nicknames`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setList(d.nicknames))
      .catch(() => {});
  }, [available, code, setList]);

  const pending = list.filter((n) => n.status === "pending");
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending.length]);

  const visible = list.filter((n) => n.status !== "hidden");
  if (!available || mode === "off" || visible.length === 0) return null;

  async function act(id: string, run: () => Promise<boolean>) {
    setBusy(id);
    setNote(null);
    try {
      if (!(await run())) setNote("Couldn't do that. The AI budget for tonight may be used up.");
    } finally {
      setBusy(null);
    }
  }

  const shown = visible.filter((n) => n.status === "shown");

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent-300">
        <Sparkle size={12} weight="fill" /> AI nicknames{pending.length > 0 ? ` · ${pending.length} waiting` : ""}
      </p>
      {pending.map((n) => {
        const secondsLeft = Math.max(0, Math.ceil((n.generatedAt + AI_AUTO_SHOW_MS - now) / 1000));
        return (
          <div key={n.id} className="flex items-center gap-3 rounded-md bg-bg p-2">
            <div className="min-w-0 flex-1 text-left">
              <p className="flex items-center gap-1 truncate text-xs text-accent-300">
                <Emoji value={n.guestEmoji} size={12} /> {n.guestName}
              </p>
              <p className="truncate text-sm text-accent-100"><EmojiText text={n.nickname} size={15} /></p>
              <p className="truncate text-xs text-accent-300">{n.why}</p>
              <p className="text-[10px] text-accent-300">Shows itself in {secondsLeft}s</p>
            </div>
            <button
              disabled={busy === n.id}
              onClick={() => act(n.id, () => post(`/rooms/${code}/ai-nicknames/${n.id}/approve`))}
              className="grid h-9 w-9 place-items-center rounded-md bg-accent text-bg disabled:opacity-50"
              aria-label={`Approve ${n.nickname}`}
            >
              <Check size={18} weight="bold" />
            </button>
            <button
              disabled={busy === n.id}
              onClick={() => act(n.id, () => post(`/rooms/${code}/ai-nicknames/${n.id}/hide`))}
              className="grid h-9 w-9 place-items-center rounded-md bg-accent-900 text-accent-100 disabled:opacity-50"
              aria-label={`Hide ${n.nickname}`}
            >
              <EyeSlash size={18} />
            </button>
          </div>
        );
      })}
      {shown.map((n) => (
        <div key={n.id} className="flex items-center gap-3 rounded-md bg-bg p-2">
          <div className="min-w-0 flex-1 text-left">
            <p className="flex items-center gap-1 truncate text-xs text-accent-300">
              <Emoji value={n.guestEmoji} size={12} /> {n.guestName}
            </p>
            <p className="truncate text-sm text-accent-100"><EmojiText text={n.nickname} size={15} /></p>
          </div>
          <button
            disabled={busy === n.guestId}
            onClick={() => act(n.guestId, () => post(`/rooms/${code}/guests/${n.guestId}/ai-nickname/regenerate`))}
            className="grid h-9 w-9 place-items-center rounded-md bg-accent-900 text-accent-100 disabled:opacity-50"
            aria-label={`New nickname for ${n.guestName}`}
          >
            <ArrowsClockwise size={16} />
          </button>
          <button
            disabled={busy === n.id}
            onClick={() => act(n.id, () => post(`/rooms/${code}/ai-nicknames/${n.id}/hide`))}
            className="grid h-9 w-9 place-items-center rounded-md bg-accent-900 text-accent-100 disabled:opacity-50"
            aria-label={`Hide ${n.nickname}`}
          >
            <EyeSlash size={16} />
          </button>
        </div>
      ))}
      {note && <p className="text-xs text-danger">{note}</p>}
    </div>
  );
}
