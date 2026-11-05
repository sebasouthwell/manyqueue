import { useEffect, useRef, useState } from "react";
import { ArrowBendUpRight, CaretDown, CaretLeft, CaretRight, GearSix, Shuffle, SkipForward, X } from "@phosphor-icons/react";
import { TURN_WEIGHTS, type HostRotationBoardView, type RoomSettings } from "@manyqueue/shared";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";

type BoardGuest = HostRotationBoardView["guests"][number];

/** The host Queues board (the Rotation-mode design §9). A strip of person buttons in turn order (with their
 * ×weight), then one numbered queue (on deck + the live "Coming up" forecast). Everything about one
 * person — their songs, Draft, weight, skip turn — lives only in their modal, opened from the strip or
 * from any of their rows, so no control is drawn twice. Drafting settings fold away. */
export function HostRotationBoard({ code }: { code: string }) {
  const board = useRoomStore((s) => s.rotationHost);
  const settings = useRoomStore((s) => s.settings);
  const [person, setPerson] = useState<{ guestId: string; highlight: string | null } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  async function patchSettings(update: Partial<RoomSettings>) {
    await fetch(`/rooms/${code}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
  }

  async function draftItem(itemId: string) {
    await fetch(`/rooms/${code}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
  }

  async function draftRandom() {
    await fetch(`/rooms/${code}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ random: true }),
    });
  }

  async function pullFromBallot(itemId: string) {
    await fetch(`/rooms/${code}/ballot/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
  }

  async function skipPending(itemId: string | null) {
    await fetch(`/rooms/${code}/draft/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
  }

  async function skipTurn(guestId: string) {
    await fetch(`/rooms/${code}/rotation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skip: guestId }),
    });
  }

  async function setWeight(guestId: string, value: number) {
    await fetch(`/rooms/${code}/rotation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weight: { guestId, value } }),
    });
  }

  if (!board || !settings) {
    return (
      <div className="w-full rounded-lg bg-panel ring-1 ring-panel-line p-4 text-sm text-accent-300">
        Loading the Queues board…
      </div>
    );
  }

  const guestById = new Map(board.guests.map((g) => [g.guestId, g]));
  // Strip order = who's coming up first in the forecast, then everyone else in turn priority, empty queues last.
  const seen = new Set<string>();
  const order: BoardGuest[] = [];
  for (const e of board.ballot?.entries ?? []) {
    const g = e.owner ? guestById.get(e.owner.guestId) : undefined;
    if (g && !seen.has(g.guestId)) { seen.add(g.guestId); order.push(g); }
  }
  for (const slot of board.upcoming) {
    const g = slot.guestId ? guestById.get(slot.guestId) : undefined;
    if (g && !seen.has(g.guestId)) { seen.add(g.guestId); order.push(g); }
  }
  for (const g of board.guests) if (!seen.has(g.guestId) && !g.empty) order.push(g);
  for (const g of board.guests) if (!seen.has(g.guestId) && g.empty) order.push(g);
  const open = person ? guestById.get(person.guestId) : undefined;

  const scrollStrip = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: "smooth" });
  const art = (url: string | null, size: string) =>
    url ? <img src={url} alt="" className={`${size} shrink-0 rounded`} /> : <div className={`${size} shrink-0 rounded bg-accent-800`} />;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs uppercase tracking-wide text-accent-300">Turn order · {board.guests.length}</p>
          <button
            onClick={draftRandom}
            className="flex items-center gap-1.5 rounded-full border border-accent-700 px-3 py-1 text-xs font-medium text-accent-100"
          >
            <Shuffle size={14} /> Draft random
          </button>
        </div>
        {order.length === 0 ? (
          <p className="text-xs text-accent-300">No one has joined yet.</p>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => scrollStrip(-1)} className="shrink-0 rounded-full p-1 text-accent-300" aria-label="Scroll people left">
              <CaretLeft size={16} />
            </button>
            <div ref={strip} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scroll-smooth" style={{ scrollbarWidth: "none" }}>
              {order.map((g) => (
                <button
                  key={g.guestId}
                  onClick={() => setPerson({ guestId: g.guestId, highlight: null })}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-bg py-1 pl-1.5 pr-2.5 text-xs text-accent-100"
                  style={{ opacity: g.empty ? 0.5 : 1 }}
                  title={g.empty ? `${g.nickname} — no songs` : `${g.nickname} — ${g.songs.length} songs`}
                >
                  <Emoji value={g.emoji} size={16} />
                  <span className="max-w-[7rem] truncate">{g.nickname}</span>
                  <span className={`rounded-full px-1.5 text-[10px] font-semibold ${g.weight !== 1 ? "bg-accent text-bg" : "bg-accent-700/50 text-accent-200"}`}>
                    ×{g.weight}
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => scrollStrip(1)} className="shrink-0 rounded-full p-1 text-accent-300" aria-label="Scroll people right">
              <CaretRight size={16} />
            </button>
          </div>
        )}

        <p className="mt-2 text-xs uppercase tracking-wide text-accent-300">Queue · changes live</p>
        {board.onDeck.map((item, i) => (
          <div key={item.id} className="flex items-center gap-3 rounded-md bg-bg px-2 py-1.5">
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-accent-300">{i + 1}</span>
            {art(item.albumArtUrl, "h-9 w-9")}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-accent-100">{item.trackName}</p>
              <p className="truncate text-xs text-accent-300">
                {item.isMystery ? "🕵️ Mystery" : item.addedBy ? `${item.addedBy.emoji} ${item.addedBy.nickname}` : "🎲 House pick"}
                {item.pickedByCrowd ? " · picked by the crowd" : ""}
              </p>
            </div>
            <span className="whitespace-nowrap rounded-full bg-accent-700/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-200">
              {i === 0 ? "Now" : item.locked ? "Locked" : "On deck"}
            </span>
          </div>
        ))}
        {board.pendingDraft && (
          <PendingDraftCard
            pending={board.pendingDraft}
            onSwap={() => {
              const g = board.pendingDraft?.guestId ? guestById.get(board.pendingDraft.guestId) : undefined;
              if (g) setPerson({ guestId: g.guestId, highlight: board.pendingDraft!.itemId });
              else strip.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onSkip={() => skipPending(board.pendingDraft!.itemId)}
          />
        )}
        {board.ballot && (
          <>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-accent-300">
              Crowd pick · {board.ballot.totalVotes} vote{board.ballot.totalVotes === 1 ? "" : "s"} · tap for their queue
            </p>
            {[...board.ballot.entries].sort((a, b) => b.votes - a.votes).map((e) => {
              const g = e.owner ? guestById.get(e.owner.guestId) : undefined;
              return (
                <div key={e.itemId} className="flex items-center gap-2 rounded-md bg-bg px-2 py-1.5">
                  <button
                    type="button"
                    disabled={!g}
                    onClick={() => g && setPerson({ guestId: g.guestId, highlight: e.itemId })}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-accent-100">{e.votes}</span>
                    {art(e.albumArtUrl, "h-9 w-9")}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-accent-100">
                        {e.isWildcard ? "🔥 " : ""}
                        {e.trackName}
                      </p>
                      <p className="truncate text-xs text-accent-300">
                        {e.isMystery ? "🕵️ Mystery" : e.owner ? `${e.owner.emoji} ${e.owner.nickname}` : ""}
                        {e.lostRounds ? ` · lost ${e.lostRounds}` : ""}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => pullFromBallot(e.itemId)}
                    className="shrink-0 rounded-md bg-section px-2 py-1 text-[11px] text-accent-100"
                    aria-label={`Pull ${e.trackName} off the ballot`}
                  >
                    Pull
                  </button>
                </div>
              );
            })}
          </>
        )}
        {board.upcoming.map((slot, i) => {
          const g = slot.guestId ? guestById.get(slot.guestId) : undefined;
          if (i === 0 && board.pendingDraft) return null; // shown in the card above
          return (
            <button
              key={i}
              type="button"
              disabled={!g}
              onClick={() => g && setPerson({ guestId: g.guestId, highlight: slot.itemId })}
              className="flex items-center gap-3 rounded-md bg-bg px-2 py-1.5 text-left"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-accent-300">{board.onDeck.length + i + 1}</span>
              {slot.kind === "guest" ? (
                <>
                  {art(slot.albumArtUrl, "h-9 w-9")}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-accent-100">{slot.trackName ?? "—"}</p>
                    <p className="truncate text-xs text-accent-300">
                      {slot.addedBy ? `${slot.addedBy.emoji} ${slot.addedBy.nickname}` : ""}
                      {slot.artistName ? ` · ${slot.artistName}` : ""}
                    </p>
                  </div>
                </>
              ) : (
                <p className="truncate text-sm text-accent-200">
                  {slot.kind === "mystery" ? "🕵️ Mystery pick" : "🎲 House music until someone adds a song"}
                </p>
              )}
            </button>
          );
        })}
        <p className="mt-1 text-[10px] text-accent-300">
          {board.onDeck.length <= 1 ? "The next song is drafted about 15 seconds before this one ends. " : ""}
          {board.ballot
            ? "Guests vote while this song plays; the winner goes on deck when the vote closes. Pull sends a song back to its owner's queue; Draft now plays a song next and the vote carries over."
            : settings.nextSongMethod === "crowd"
              ? "Crowd pick: a vote opens as the next song starts (not for songs too short to vote on). Tap a person to manage them."
              : "Coming up is a forecast from everyone's queues in turn order; guests can reorder until their song is drafted. Tap a person or a song to manage them."}
        </p>
      </div>

      {board.pool.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4">
          <p className="text-xs uppercase tracking-wide text-accent-300">🕵️ Mystery pool · {board.pool.length}</p>
          <div className="flex flex-wrap gap-2">
            {board.pool.map((p) => (
              <span key={p.id} className="rounded-md bg-bg px-2 py-1 text-xs text-accent-100">
                {p.trackName}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg bg-panel ring-1 ring-panel-line p-4">
        <button type="button" onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-2 text-left" aria-expanded={showSettings}>
          <GearSix size={14} className="text-accent-300" />
          <p className="flex-1 text-xs uppercase tracking-wide text-accent-300">Rotation settings</p>
          <span className="text-xs text-accent-200">
            {settings.draftingStyle === "automatic" ? "Automatic" : settings.draftingStyle === "auto_veto" ? "Auto + veto" : "DJ mode"}
          </span>
          <CaretDown size={14} className="text-accent-300" style={{ transform: showSettings ? "rotate(180deg)" : undefined }} />
        </button>
        {showSettings && (
          <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-accent-300">Drafting</p>
          <div className="flex gap-1 rounded-lg bg-bg p-1" role="radiogroup" aria-label="Drafting style">
            {(
              [
                ["automatic", "Automatic"],
                ["auto_veto", "Auto + veto"],
                ["dj", "DJ mode"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.draftingStyle === value}
                onClick={() => patchSettings({ draftingStyle: value })}
                className={`whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  settings.draftingStyle === value ? "bg-accent text-bg" : "text-accent-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-accent-300">When you draft by hand</p>
          <div className="flex gap-1 rounded-lg bg-bg p-1" role="radiogroup" aria-label="Who pays">
            {(
              [
                ["guest", "Guest pays"],
                ["house", "On the house"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.hostDraftPays === value}
                onClick={() => patchSettings({ hostDraftPays: value })}
                className={`whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                  settings.hostDraftPays === value ? "bg-accent text-bg" : "text-accent-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
          </div>
        )}
      </div>
      {open && (
        <PersonModal
          guest={open}
          highlight={person?.highlight ?? null}
          tokenMode={settings.tokenMode}
          onClose={() => setPerson(null)}
          onDraft={(id) => { draftItem(id); setPerson(null); }}
          onSkip={() => { skipTurn(open.guestId); setPerson(null); }}
          onWeight={(w) => setWeight(open.guestId, w)}
        />
      )}
    </div>
  );
}

/** One person's queue and settings — the only place their per-person controls are drawn. */
/** Auto + veto (§9): the 15s before the draft commits, with Swap and Skip. */
function PendingDraftCard({
  pending,
  onSwap,
  onSkip,
}: {
  pending: NonNullable<HostRotationBoardView["pendingDraft"]>;
  onSwap: () => void;
  onSkip: () => void;
}) {
  const clockOffsetMs = useRoomStore((s) => s.clockOffsetMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.ceil((pending.commitsAt - (now + (clockOffsetMs ?? 0))) / 1000));
  const house = pending.kind === "house";
  return (
    <div className="flex flex-col gap-2 rounded-md bg-bg p-2 shadow-[0_0_0_1px_rgb(var(--color-accent-600))]" role="status">
      <p className="flex items-center justify-between text-[10px] uppercase tracking-wide text-accent-200">
        <span>Drafting now…</span>
        <span className="tabular-nums">{secs > 0 ? `${secs}s` : "now"}</span>
      </p>
      <div className="flex items-center gap-3">
        {pending.albumArtUrl ? (
          <img src={pending.albumArtUrl} alt="" className="h-10 w-10 shrink-0 rounded" />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded bg-accent-800" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-accent-100">
            {pending.kind === "guest" ? pending.trackName : pending.kind === "mystery" ? "🕵️ Mystery pick" : "🎲 House pick"}
          </p>
          <p className="truncate text-xs text-accent-300">
            {pending.addedBy ? `${pending.addedBy.emoji} ${pending.addedBy.nickname}` : ""}
            {pending.artistName ? ` · ${pending.artistName}` : ""}
          </p>
        </div>
        <button onClick={onSwap} className="shrink-0 rounded-md bg-section px-2 py-1 text-[11px] text-accent-100">
          Swap
        </button>
        {!house && (
          <button onClick={onSkip} className="shrink-0 rounded-md bg-section px-2 py-1 text-[11px] text-accent-100">
            Skip
          </button>
        )}
      </div>
      <p className="text-[10px] text-accent-300">
        Swap: Draft now any other song. Skip: the next in line gets this slot{pending.kind === "guest" ? " and they keep their turn" : ""}.
      </p>
    </div>
  );
}

function PersonModal({
  guest: g,
  highlight,
  tokenMode,
  onClose,
  onDraft,
  onSkip,
  onWeight,
}: {
  guest: BoardGuest;
  highlight: string | null;
  tokenMode: boolean;
  onClose: () => void;
  onDraft: (itemId: string) => void;
  onSkip: () => void;
  onWeight: (w: number) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (highlight) document.getElementById(`pm-${highlight}`)?.scrollIntoView({ block: "center" });
  }, [highlight]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-bg/70 sm:items-center sm:px-6" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${g.nickname}'s queue`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-t-lg bg-section p-4 shadow-2xl outline-none sm:rounded-lg"
      >
        <div className="flex items-center gap-2">
          <Emoji value={g.emoji} size={24} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-accent-100">{g.nickname}</p>
            <p className="text-xs text-accent-300">
              {g.empty ? "No songs yet" : `${g.songs.length} song${g.songs.length === 1 ? "" : "s"}`}
              {tokenMode ? ` · ${g.tokenBalance} 🪙` : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-accent-300" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-[10px] uppercase tracking-wide text-accent-300">Turn weight</p>
          <div className="flex gap-0.5 rounded-md bg-bg p-0.5" role="radiogroup" aria-label={`${g.nickname}'s turn weight`}>
            {TURN_WEIGHTS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={g.weight === w}
                onClick={() => onWeight(w)}
                className={`flex-1 rounded px-1 py-1.5 text-xs font-semibold transition-colors ${g.weight === w ? "bg-accent text-bg" : "text-accent-300"}`}
              >
                ×{w}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onSkip}
          disabled={g.empty}
          className="flex items-center justify-center gap-1.5 rounded-md border border-accent-700 py-2 text-sm text-accent-100 disabled:opacity-40"
        >
          <SkipForward size={14} /> Skip {g.nickname}'s next turn
        </button>
        {!g.canAfford && !g.empty && (
          <p className="rounded-md bg-accent-900 px-2 py-1 text-[11px] text-accent-200">Can't afford a turn — drafting by hand is free</p>
        )}

        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {g.songs.map((s, i) => (
            <div
              key={s.id}
              id={`pm-${s.id}`}
              className="flex items-center gap-2 rounded-md p-1.5"
              style={{ background: s.id === highlight ? "rgb(var(--color-accent-700) / 0.5)" : "rgb(var(--color-bg))" }}
            >
              <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-accent-300">{i + 1}</span>
              {s.albumArtUrl ? <img src={s.albumArtUrl} alt="" className="h-9 w-9 shrink-0 rounded" /> : <div className="h-9 w-9 shrink-0 rounded bg-accent-800" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-accent-100">{s.trackName}</p>
                <p className="truncate text-xs text-accent-300">{s.artistName}</p>
              </div>
              <button
                onClick={() => onDraft(s.id)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-panel px-2 py-1 text-[11px] text-accent-100"
                aria-label={`Draft ${s.trackName} now`}
              >
                <ArrowBendUpRight size={12} /> Draft
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
