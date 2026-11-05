import { useEffect, useState } from "react";
import { Megaphone } from "@phosphor-icons/react";
import { ANNOUNCEMENT_MAX_LENGTH, ANNOUNCEMENT_COOLDOWN_MS } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";

/** A fun little feature: any guest can blast a short message to the whole room (TV + every phone).
 * On by default; renders nothing once staff has taken it away from this guest specifically. */
export function AnnouncementComposer({ code }: { code: string }) {
  const canAnnounce = useRoomStore((s) => s.canAnnounce);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!cooldownUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  if (!canAnnounce) return null;

  const cooldownLeft = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0;
  const cooling = cooldownLeft > 0;

  async function send() {
    if (!message.trim() || sending || cooling) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/rooms/${code}/announce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (res.status === 429) {
        const body = await res.json();
        setCooldownUntil(Date.now() + (body.retryAfterMs ?? ANNOUNCEMENT_COOLDOWN_MS));
        setNow(Date.now());
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.reason === "too_long" ? "That's a bit long." : "Couldn't send — try again.");
        return;
      }
      setMessage("");
      setCooldownUntil(Date.now() + ANNOUNCEMENT_COOLDOWN_MS);
      setNow(Date.now());
    } catch {
      setError("Couldn't send — check your connection.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-2 rounded-lg bg-section p-4">
      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent-300">
        <Megaphone size={13} weight="fill" /> Announce to the room
      </p>
      <div className="flex items-center gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, ANNOUNCEMENT_MAX_LENGTH))}
          onKeyDown={(e) => e.key === "Enter" && send()}
          maxLength={ANNOUNCEMENT_MAX_LENGTH}
          disabled={cooling}
          placeholder={cooling ? `Wait ${cooldownLeft}s…` : "Pizza's here!"}
          className="min-w-0 flex-1 rounded-full bg-bg px-4 py-2 text-sm text-accent-100 outline-none disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!message.trim() || sending || cooling}
          aria-label="Send announcement"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-bg disabled:opacity-40"
        >
          <Megaphone size={16} weight="fill" />
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-accent-300 text-[10px]">Shows on the TV and everyone's phone. Once a minute.</p>
    </div>
  );
}
