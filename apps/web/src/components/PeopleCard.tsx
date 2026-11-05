import { useEffect, useState } from "react";
import { Star, Coin, Minus, Plus, CaretDown, SpeakerSlash, Megaphone, PencilSimple, Prohibit, Key, Lock, LockOpen } from "@phosphor-icons/react";
import {
  PERMISSIONS,
  PERMISSION_HINTS,
  PERMISSION_LABELS,
  permissionBadge,
  SOCKET_EVENTS,
  type GuestSummary,
  type GuestTokensPayload,
  type Permission,
} from "@manyqueue/shared";
import { getSocket } from "../socket";
import { useRoomStore } from "../store/roomStore";
import { useCan } from "../hooks/useCan";
import { Emoji, EmojiText } from "./Emoji";
import { Dialog } from "./Dialog";

const REASON_CHIPS = ["💃 Won the dance-off", "🎤 Sang along", "🍕 Brought snacks"];

/**
 * `asHost`: the host's desk, which can also change roles and permissions.
 * Otherwise this is a guest with some permissions using the phone's People tab:
 * they get only the parts they were given (tokens, moderation).
 * `wide`: fill the column, so an opened row's chips lay out in one line.
 */
export function PeopleCard({
  code,
  asHost = true,
  wide = false,
  selfId,
}: {
  code: string;
  asHost?: boolean;
  wide?: boolean;
  /** This viewer's own guest id (phone): you can't moderate yourself. */
  selfId?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice((n) => (n === message ? null : n)), 4000);
  }
  async function refusal(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    if (res.status === 403 && body?.error === "cannot_moderate") return "You can't moderate a co-host, or yourself.";
    if (res.status === 403) return "You don't have permission for that.";
    return "Couldn't do that. Try again.";
  }
  const holdsTokens = useCan("tokens");
  const holdsModeration = useCan("moderation");
  const canTokens = asHost || holdsTokens;
  const canModeration = asHost || holdsModeration;
  const [guests, setGuests] = useState<GuestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [granting, setGranting] = useState<GuestSummary | null>(null);
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState(REASON_CHIPS[0]);
  const [customReason, setCustomReason] = useState("");
  const [grantError, setGrantError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discreet, setDiscreet] = useState(false);
  const [renaming, setRenaming] = useState<GuestSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ guest: GuestSummary; action: "mute" | "unmute" | "kick" } | null>(null);

  // Host-desk only: a PIN screen-lock, so someone at an unattended, already-logged-in laptop can't
  // just tap Make co-host. Not a real auth boundary (the host_session cookie already grants full
  // power) — it re-locks every time this mounts (a page load, or opening the People section again).
  const [pinSet, setPinSet] = useState(false);
  const [locked, setLocked] = useState(asHost);
  const [pinInput, setPinInput] = useState("");
  const [pinCheckError, setPinCheckError] = useState<string | null>(null);
  const [checkingPin, setCheckingPin] = useState(false);
  const [settingUpPin, setSettingUpPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [pinSetupError, setPinSetupError] = useState<string | null>(null);

  useEffect(() => {
    if (!asHost) return;
    fetch(`/rooms/${code}/people-lock`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const isSet = !!data?.set;
        setPinSet(isSet);
        setLocked(isSet);
      })
      .catch(() => setLocked(false));
  }, [asHost, code]);

  async function submitPinCheck() {
    setCheckingPin(true);
    setPinCheckError(null);
    try {
      const res = await fetch(`/rooms/${code}/people-lock/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.status === 429) {
        setPinCheckError("Too many tries — wait a few minutes.");
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.ok) {
        setLocked(false);
        setPinInput("");
      } else {
        setPinCheckError("Wrong PIN.");
      }
    } finally {
      setCheckingPin(false);
    }
  }

  async function submitPinSetup(pin: string | null) {
    setPinSetupError(null);
    const res = await fetch(`/rooms/${code}/people-lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) {
      setPinSetupError("Couldn't save that PIN — use 4 to 8 digits.");
      return;
    }
    setPinSet(!!pin);
    setSettingUpPin(false);
    setNewPin("");
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/rooms/${code}/guests`);
      if (res.ok) {
        const data = await res.json();
        setGuests(data.guests);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Balances change all night (grants, spending, passive income); the server pushes each change to staff.
  useEffect(() => {
    const socket = getSocket();
    function onTokens(p: GuestTokensPayload) {
      // Only patch balances this viewer can already see (the list decides that per viewer).
      setGuests((prev) =>
        prev.map((g) => (g.id === p.guestId && g.tokenBalance !== null ? { ...g, tokenBalance: p.balance } : g)),
      );
    }
    socket.on(SOCKET_EVENTS.GUEST_TOKENS, onTokens);
    return () => {
      socket.off(SOCKET_EVENTS.GUEST_TOKENS, onTokens);
    };
  }, []);

  async function toggleRole(guest: GuestSummary) {
    const nextRole = guest.role === "cohost" ? "guest" : "cohost";
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, role: nextRole } : g)));
    await fetch(`/rooms/${code}/guests/${guest.id}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
  }

  async function togglePerm(guest: GuestSummary, perm: Permission) {
    const next = guest.perms.includes(perm) ? guest.perms.filter((p) => p !== perm) : [...guest.perms, perm];
    const ordered = PERMISSIONS.filter((p) => next.includes(p));
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, perms: ordered } : g)));
    const res = await fetch(`/rooms/${code}/guests/${guest.id}/perms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perms: ordered }),
    });
    if (!res.ok) refresh();
  }

  async function toggleAnnounce(guest: GuestSummary) {
    const next = !guest.canAnnounce;
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, canAnnounce: next } : g)));
    const res = await fetch(`/rooms/${code}/guests/${guest.id}/announce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canAnnounce: next }),
    });
    if (!res.ok) {
      flash(await refusal(res));
      refresh();
    }
  }

  async function submitRename() {
    if (!renaming || !renameDraft.trim()) return;
    const guest = renaming;
    setRenaming(null);
    const res = await fetch(`/rooms/${code}/guests/${guest.id}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: renameDraft.trim() }),
    });
    if (!res.ok) {
      flash(await refusal(res));
      return;
    }
    const data = await res.json();
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, nickname: data.nickname } : g)));
  }

  async function runModeration() {
    if (!confirming) return;
    const { guest, action } = confirming;
    setConfirming(null);
    const path = action === "unmute" ? "mute" : action;
    const res = await fetch(`/rooms/${code}/guests/${guest.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "unmute" ? { muted: false } : {}),
    });
    if (!res.ok) {
      flash(await refusal(res));
      refresh();
      return;
    }
    if (action === "kick") setGuests((prev) => prev.filter((g) => g.id !== guest.id));
    else if (action === "mute" || action === "unmute") {
      setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, muted: action === "mute" } : g)));
    }
  }

  function openGrant(guest: GuestSummary) {
    setGranting(guest);
    setAmount(1);
    setReason(REASON_CHIPS[0]);
    setCustomReason("");
    setGrantError(null);
    setDiscreet(false);
  }

  async function submitGrant() {
    if (!granting) return;
    setSaving(true);
    setGrantError(null);
    try {
      const res = await fetch(`/rooms/${code}/guests/${granting.id}/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, reason: customReason.trim() || reason, discreet }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => null);
        setGrantError(
          body?.error === "penalty_limit_reached"
            ? "This co-host has hit the 10-penalty-per-hour limit."
            : "This co-host has hit the 5-token-per-hour grant limit.",
        );
        return;
      }
      if (res.status === 400) {
        const body = await res.json();
        setGrantError(body.error === "at_cap" ? "That guest is already at the token cap." : "Couldn't grant — try again.");
        return;
      }
      if (!res.ok) {
        setGrantError("Couldn't grant — try again.");
        return;
      }
      setGranting(null);
      void refresh();
    } finally {
      setSaving(false);
    }
  }

  // The AI nickname a guest shows now: live list from the socket once it has entries for them, else what
  // the People request returned.
  const aiList = useRoomStore((s) => s.aiNicknames);
  function shownAi(guest: GuestSummary): { nickname: string } | null {
    const mine = aiList.filter((n) => n.guestId === guest.id);
    if (mine.length > 0) return mine.find((n) => n.status === "shown") ?? null;
    return guest.aiNickname?.status === "shown" ? guest.aiNickname : null;
  }

  if (asHost && locked) {
    return (
      <div className={`flex w-full flex-col items-center gap-3 rounded-lg bg-panel ring-1 ring-panel-line p-6 text-center ${wide ? "" : "max-w-sm"}`}>
        <Lock size={22} className="text-accent-300" />
        <p className="text-sm text-accent-100">People is locked</p>
        <input
          type="password"
          inputMode="numeric"
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => e.key === "Enter" && submitPinCheck()}
          placeholder="PIN"
          autoFocus
          className="w-32 rounded-full bg-bg px-4 py-2 text-center text-lg tracking-[0.3em] text-accent-100 outline-none"
        />
        {pinCheckError && <p className="text-xs text-danger">{pinCheckError}</p>}
        <button
          onClick={submitPinCheck}
          disabled={checkingPin || pinInput.length < 4}
          className="rounded-full border border-accent px-4 py-1.5 text-xs font-semibold text-accent-100 disabled:opacity-40"
        >
          Unlock
        </button>
      </div>
    );
  }

  if (guests.length === 0 && !loading) return null;

  return (
    <div className={`flex w-full flex-col gap-1 rounded-lg bg-panel ring-1 ring-panel-line p-4 ${wide ? "" : "max-w-sm"}`}>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-accent-300">People · {guests.length}</p>
        {asHost && (
          <button
            onClick={() => (pinSet ? submitPinSetup(null) : setSettingUpPin(true))}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent-300"
            title={pinSet ? "Remove the People PIN lock" : "Lock this section with a PIN"}
          >
            {pinSet ? <LockOpen size={12} /> : <Lock size={12} />}
            {pinSet ? "Remove lock" : "Lock with PIN"}
          </button>
        )}
      </div>
      {settingUpPin && (
        <div className="mb-1 flex items-center gap-2 rounded-md bg-bg p-2">
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="4-8 digit PIN"
            autoFocus
            className="min-w-0 flex-1 rounded-full bg-panel px-3 py-1.5 text-sm text-accent-100 outline-none"
          />
          <button
            onClick={() => submitPinSetup(newPin)}
            disabled={newPin.length < 4}
            className="whitespace-nowrap rounded-full border border-accent px-2.5 py-1 text-[11px] text-accent-100 disabled:opacity-40"
          >
            Set
          </button>
          <button onClick={() => setSettingUpPin(false)} className="text-[11px] text-accent-300">
            Cancel
          </button>
        </div>
      )}
      {pinSetupError && <p className="mb-1 text-[11px] text-danger">{pinSetupError}</p>}
      {notice && (
        <p className="mb-1 rounded-md bg-danger/15 px-3 py-2 text-xs text-danger" role="alert">
          {notice}
        </p>
      )}
      {guests.map((guest) => {
        const badge = permissionBadge(guest.role, guest.perms ?? []);
        const isCohost = guest.role === "cohost";
        // A co-host (or anyone with Moderation) can't moderate a co-host or themselves; only the host can.
        const protectedTarget = !asHost && (isCohost || guest.id === selfId);
        const expandable = asHost || (canModeration && !protectedTarget);
        const expanded = expandedId === guest.id;
        return (
          <div key={guest.id} className="flex flex-col gap-1.5 rounded-md bg-bg p-2">
            <div className="flex items-center gap-2">
              <Emoji value={guest.emoji} size={20} />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm text-accent-100">{guest.nickname}</p>
                {shownAi(guest) && (
                  <p className="truncate text-[11px] text-accent-300">✨ <EmojiText text={shownAi(guest)!.nickname} size={12} /></p>
                )}
              </div>
              {badge === "extra" && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent-700/50 px-2 py-0.5 text-[10px] font-semibold text-accent-200">
                  <Key size={10} weight="fill" /> Xtra Perms
                </span>
              )}
              {!asHost && badge === "cohost" && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-accent-300">
                  <Star size={10} weight="fill" /> Co-host
                </span>
              )}
              <span className="flex-1" />
              {guest.tokenBalance !== null && (
                <span className="flex items-center gap-1 text-xs tabular-nums text-accent-300">
                  <Coin size={12} weight="fill" /> {guest.tokenBalance}
                </span>
              )}
              {canTokens && (asHost || guest.id !== selfId) && (
                <button
                  onClick={() => openGrant(guest)}
                  className="flex items-center gap-1 whitespace-nowrap rounded-full border border-accent-700 px-2.5 py-1 text-[11px] font-semibold text-accent-200"
                >
                  <Coin size={11} weight="fill" /> Grant
                </button>
              )}
              {asHost && (
                <button
                  onClick={() => toggleRole(guest)}
                  className="flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                  style={{
                    borderColor: isCohost ? "rgb(var(--color-accent-300))" : "rgb(var(--color-accent-700))",
                    color: isCohost ? "rgb(var(--color-accent-300))" : "rgb(var(--color-accent-200))",
                  }}
                >
                  <Star size={11} weight={isCohost ? "fill" : "regular"} />
                  {isCohost ? "Co-host" : "Make co-host"}
                </button>
              )}
              {expandable && (
                <button
                  onClick={() => setExpandedId((id) => (id === guest.id ? null : guest.id))}
                  className="text-accent-300"
                  aria-label={`More for ${guest.nickname}`}
                  aria-expanded={expanded}
                >
                  <CaretDown size={16} style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 150ms" }} />
                </button>
              )}
            </div>

            {expanded && asHost && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-accent-700/50 pt-1.5">
                <span className="mr-1 text-[11px] uppercase tracking-wide text-accent-300">Permissions</span>
                {PERMISSIONS.map((perm) => {
                  const on = isCohost || guest.perms.includes(perm);
                  return (
                    <button
                      key={perm}
                      onClick={() => togglePerm(guest, perm)}
                      disabled={isCohost}
                      aria-pressed={on}
                      title={PERMISSION_HINTS[perm]}
                      className="rounded-full border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-100"
                      style={{
                        borderColor: on ? "rgb(var(--color-accent))" : "rgb(var(--color-accent-700))",
                        background: on ? "rgb(var(--color-accent) / 0.18)" : "transparent",
                        color: on ? "rgb(var(--color-accent-100))" : "rgb(var(--color-accent-300))",
                        opacity: isCohost ? 0.7 : 1,
                      }}
                    >
                      {on ? "✓ " : ""}
                      {PERMISSION_LABELS[perm]}
                    </button>
                  );
                })}
                {isCohost && <span className="text-[11px] text-accent-300">Co-hosts have every permission.</span>}
              </div>
            )}

            {expanded && canModeration && (
              <div className="flex flex-wrap justify-end gap-1.5 border-t border-danger/30 pt-1.5">
                <button
                  onClick={() => setConfirming({ guest, action: guest.muted ? "unmute" : "mute" })}
                  className="flex items-center gap-1 rounded-full border border-danger/60 px-2.5 py-1 text-[11px] text-danger"
                >
                  <SpeakerSlash size={11} /> {guest.muted ? "Unmute" : "Mute"}
                </button>
                <button
                  onClick={() => toggleAnnounce(guest)}
                  className="flex items-center gap-1 rounded-full border border-danger/60 px-2.5 py-1 text-[11px] text-danger"
                >
                  <Megaphone size={11} /> {guest.canAnnounce ? "Block announcing" : "Allow announcing"}
                </button>
                <button
                  onClick={() => {
                    setRenameDraft(guest.nickname);
                    setRenaming(guest);
                  }}
                  className="flex items-center gap-1 rounded-full border border-danger/60 px-2.5 py-1 text-[11px] text-danger"
                >
                  <PencilSimple size={11} /> Rename
                </button>
                <button
                  onClick={() => setConfirming({ guest, action: "kick" })}
                  className="flex items-center gap-1 rounded-full border border-danger/60 px-2.5 py-1 text-[11px] text-danger"
                >
                  <Prohibit size={11} /> Kick
                </button>
              </div>
            )}
          </div>
        );
      })}

      {renaming && (
        <Dialog
          title={`Rename ${renaming.nickname}`}
          body={
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value.slice(0, 20))}
              maxLength={20}
              className="w-full rounded-md bg-bg px-3 py-2 text-sm text-accent-100 outline-none"
            />
          }
          primaryLabel="Rename"
          onPrimary={submitRename}
          secondaryLabel="Cancel"
          onSecondary={() => setRenaming(null)}
        />
      )}

      {confirming && (
        <Dialog
          title={
            confirming.action === "kick"
              ? `Kick ${confirming.guest.nickname}?`
              : confirming.action === "mute"
                ? `Mute ${confirming.guest.nickname}?`
                : `Unmute ${confirming.guest.nickname}?`
          }
          body={
            confirming.action === "kick"
              ? "They're removed for the night and archived as kicked. Their waiting songs are refunded and pulled from the queue, and their device can't rejoin."
              : confirming.action === "mute"
                ? "They can still vote and react, but can't add songs."
                : "They can add songs again."
          }
          primaryLabel="Confirm"
          onPrimary={runModeration}
          secondaryLabel="Cancel"
          onSecondary={() => setConfirming(null)}
        />
      )}

      {granting && (
        <Dialog
          title={`Grant tokens to ${granting.nickname}`}
          body={
            <div className="flex flex-col gap-3 text-left">
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() =>
                    setAmount((a) => {
                      const next = a - 1;
                      return Math.max(-3, next === 0 ? -1 : next);
                    })
                  }
                  className="grid h-9 w-9 place-items-center rounded-full bg-bg text-accent-100"
                >
                  <Minus size={16} />
                </button>
                <span className="w-14 text-center text-2xl font-bold tabular-nums text-accent-100">
                  {amount > 0 ? "+" : ""}
                  {amount}
                </span>
                <button
                  onClick={() =>
                    setAmount((a) => {
                      const next = a + 1;
                      return Math.min(3, next === 0 ? 1 : next);
                    })
                  }
                  className="grid h-9 w-9 place-items-center rounded-full bg-bg text-accent-100"
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {REASON_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => {
                      setReason(chip);
                      setCustomReason("");
                    }}
                    className="rounded-full px-2.5 py-1 text-xs"
                    style={{
                      background:
                        reason === chip && !customReason
                          ? "rgb(var(--color-accent) / 0.16)"
                          : "rgb(var(--color-bg))",
                      boxShadow:
                        reason === chip && !customReason ? "0 0 0 1.5px rgb(var(--color-accent))" : "none",
                      color: "rgb(var(--color-accent-100))",
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value.slice(0, 60))}
                placeholder="Or type a custom reason…"
                className="rounded-md bg-bg px-3 py-2 text-sm text-accent-100 outline-none"
              />
              {amount > 0 && (
                <label className="flex items-center justify-center gap-2 text-xs text-accent-200">
                  <input
                    type="checkbox"
                    checked={discreet}
                    onChange={(e) => setDiscreet(e.target.checked)}
                    className="accent-[rgb(var(--color-accent))]"
                  />
                  Discreet — don't announce it to the room
                </label>
              )}
              {grantError && <p className="text-center text-danger text-xs">{grantError}</p>}
            </div>
          }
          primaryLabel={saving ? "Granting…" : amount > 0 ? `Grant +${amount} 🪙` : `Dock ${amount} 🪙`}
          onPrimary={submitGrant}
          secondaryLabel="Cancel"
          onSecondary={() => setGranting(null)}
        />
      )}
    </div>
  );
}
