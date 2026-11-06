import { useEffect, useRef, useState } from "react";
import { ArrowBendUpRight, ArrowDown, ArrowUp, CaretDown, CaretLeft, CaretRight, DotsSixVertical, GearSix, PushPin, Shuffle, SkipForward, X } from "@phosphor-icons/react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TURN_WEIGHTS, type HostRotationBoardView, type RoomSettings } from "@manyqueue/shared";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";
import { HatCover } from "./Holiday";

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

  async function reorderQueue(guestId: string, itemIds: string[]) {
    await fetch(`/rooms/${code}/guests/${guestId}/mine/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds }),
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

  // Hooks above the early return below: React needs the same hooks on every render (this one after it
  // crashed the host page the moment the board loaded).
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }));

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

  // Coming up: the host's pinned songs drag to any slot; everyone else's rows just make room.
  const upcomingIds = board.upcoming.map((slot, i) => (slot.kind === "host" && slot.itemId ? `host:${slot.itemId}` : `slot:${i}`));
  async function setHostSlot(itemId: string, slot: number | null) {
    await fetch(`/rooms/${code}/host-picks/${itemId}/slot`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot }) });
  }
  function onUpcomingDragEnd(e: DragEndEvent) {
    const from = String(e.active.id);
    if (!e.over || !from.startsWith("host:")) return;
    const to = upcomingIds.indexOf(String(e.over.id));
    if (to < 0 || to === upcomingIds.indexOf(from)) return;
    void setHostSlot(from.slice(5), to);
  }

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
        <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={onUpcomingDragEnd}>
          <SortableContext items={upcomingIds} strategy={verticalListSortingStrategy}>
            {board.upcoming.map((slot, i) => {
              const g = slot.guestId ? guestById.get(slot.guestId) : undefined;
              if (i === 0 && board.pendingDraft && slot.kind !== "host") return null; // shown in the card above
              return (
                <UpcomingRow key={upcomingIds[i]} id={upcomingIds[i]} draggable={slot.kind === "host"}>
                  {(handle) => (
                    <div className="flex items-center gap-3 rounded-md bg-bg px-2 py-1.5 text-left">
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-accent-300">{board.onDeck.length + i + 1}</span>
                      {slot.kind === "host" ? (
                        <>
                          {handle}
                          {art(slot.albumArtUrl, "h-9 w-9")}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-accent-100">{slot.trackName ?? "—"}</p>
                            <p className="truncate text-xs text-accent-300">🏠 Your pick · drag to move{slot.artistName ? ` · ${slot.artistName}` : ""}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => slot.itemId && void setHostSlot(slot.itemId, null)}
                            className="shrink-0 rounded-full border border-panel-line px-2 py-0.5 text-[11px] text-accent-200"
                            aria-label={`Unpin ${slot.trackName ?? "your pick"}`}
                          >
                            Unpin
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={!g} onClick={() => g && setPerson({ guestId: g.guestId, highlight: slot.itemId })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
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
                      )}
                    </div>
                  )}
                </UpcomingRow>
              );
            })}
          </SortableContext>
        </DndContext>
        <p className="mt-1 text-[10px] text-accent-300">
          {board.onDeck.length <= 1 ? "The next song is drafted about 15 seconds before this one ends. " : ""}
          {board.ballot
            ? "Guests vote while this song plays; the winner goes on deck when the vote closes. Pull sends a song back to its owner's queue; Draft now plays a song next and the vote carries over."
            : settings.nextSongMethod === "crowd"
              ? "Crowd pick: a vote opens as the next song starts (not for songs too short to vote on). Tap a person to manage them."
              : "Coming up is a forecast from everyone's queues in turn order; guests can reorder until their song is drafted. Tap a person or a song to manage them."}
        </p>
      </div>

      {(board.house ?? []).length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-panel ring-1 ring-panel-line p-4">
          <p className="text-xs uppercase tracking-wide text-accent-300">🏠 Your house picks · {board.house.length}</p>
          <p className="text-[11px] text-accent-300">They play, in this order, whenever nobody has a song waiting, before the fallback playlist. Place one in Coming up to drag it to an exact slot.</p>
          <div className="flex flex-col gap-1">
            {board.house.map((h) => (
              <div key={h.id} className="flex items-center gap-2 rounded-md bg-bg px-2 py-1.5">
                {h.albumArtUrl ? <HatCover trackName={h.trackName} size={32}><img src={h.albumArtUrl} alt="" className="h-8 w-8 rounded" /></HatCover> : <div className="h-8 w-8 rounded bg-accent-800" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-accent-100">{h.trackName}</p>
                  <p className="truncate text-[11px] text-accent-300">{h.artistName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void setHostSlot(h.id, board.upcoming.filter((u) => u.kind !== "house").length)}
                  className="flex items-center gap-1 rounded-full border border-panel-line px-2 py-0.5 text-[11px] text-accent-200"
                  aria-label={`Place ${h.trackName} in Coming up`}
                >
                  <PushPin size={11} /> Place
                </button>
                <button
                  type="button"
                  onClick={() => void fetch(`/rooms/${code}/queue/${h.id}`, { method: "DELETE" })}
                  className="rounded-full border border-panel-line px-2 py-0.5 text-[11px] text-accent-200"
                  aria-label={`Remove ${h.trackName}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
          onReorder={(ids) => reorderQueue(open.guestId, ids)}
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
          <HatCover trackName={pending.trackName} size={40}><img src={pending.albumArtUrl} alt="" className="h-10 w-10 shrink-0 rounded" /></HatCover>
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
  onReorder,
}: {
  guest: BoardGuest;
  highlight: string | null;
  tokenMode: boolean;
  onClose: () => void;
  onDraft: (itemId: string) => void;
  onSkip: () => void;
  onWeight: (w: number) => void;
  onReorder: (itemIds: string[]) => void;
}) {
  // Shown at once; the board's next update confirms it.
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => setOrder(null), [g.songs]);
  const byId = new Map(g.songs.map((s) => [s.id, s]));
  const songs = order ? order.map((id) => byId.get(id)).filter((s): s is (typeof g.songs)[number] => !!s) : g.songs;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= songs.length) return;
    const ids = songs.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setOrder(ids);
    onReorder(ids);
  };
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
          {songs.length > 1 && <p className="text-[10px] text-accent-300">Use the arrows to change the order their songs are drafted in.</p>}
          {songs.map((s, i) => (
            <div
              key={s.id}
              id={`pm-${s.id}`}
              className="flex items-center gap-2 rounded-md p-1.5"
              style={{ background: s.id === highlight ? "rgb(var(--color-accent-700) / 0.5)" : "rgb(var(--color-bg))" }}
            >
              <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-accent-300">{i + 1}</span>
              {s.albumArtUrl ? <HatCover trackName={s.trackName} size={36}><img src={s.albumArtUrl} alt="" className="h-9 w-9 shrink-0 rounded" /></HatCover> : <div className="h-9 w-9 shrink-0 rounded bg-accent-800" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-accent-100">{s.trackName}</p>
                <p className="truncate text-xs text-accent-300">{s.artistName}</p>
              </div>
              <div className="flex shrink-0 flex-col">
                <button
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  className="rounded p-0.5 text-accent-300 disabled:opacity-25"
                  aria-label={`Move ${s.trackName} up`}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => move(i, i + 1)}
                  disabled={i === songs.length - 1}
                  className="rounded p-0.5 text-accent-300 disabled:opacity-25"
                  aria-label={`Move ${s.trackName} down`}
                >
                  <ArrowDown size={13} />
                </button>
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

/** A Coming up row in the drag list. Only the host's own picks can be dragged (by their handle); the
 * rest hold their places and make room. */
function UpcomingRow({ id, draggable, children }: { id: string; draggable: boolean; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !draggable });
  const handle = draggable ? (
    <button {...attributes} {...listeners} type="button" className="grid h-8 w-6 shrink-0 touch-none place-items-center text-accent-400" aria-label="Drag your pick to another slot">
      <DotsSixVertical size={18} />
    </button>
  ) : null;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1, zIndex: isDragging ? 2 : undefined, position: "relative" }}>
      {children(handle)}
    </div>
  );
}
