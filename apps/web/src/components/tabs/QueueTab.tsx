import { useState } from "react";
import { Play, Heart, DiceFive, PushPin, HourglassMedium, ClockCounterClockwise } from "@phosphor-icons/react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import type { UpcomingItemView } from "@manyqueue/shared";
import { useRoomStore } from "../../store/roomStore";
import { BallotCard } from "../BallotCard";
import { Emoji } from "../Emoji";
import { HistorySheet } from "../HistorySheet";
import { SongActionSheet } from "../SongActionSheet";
import { SortableMineRow } from "../SortableMineRow";

/** §8's "⭐ Host boost" card — only ever rendered when myWeight is set, which the server itself only
 * ever sends above x1 (defense in depth for the "never shown below x1" privacy rule). */
function BoostRow({ weight }: { weight: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-accent-900 px-2.5 py-2 text-xs text-accent-100">
      <span>⭐</span>
      <span>Host boost ×{weight}: your turns come {weight === 2 ? "twice" : `${weight}x`} as often</span>
    </div>
  );
}

/** Rotation mode's Queue tab (the Rotation-mode design §5, mockups 4a/4c): Mine is a guest's own queue
 * (reorder with the same up/down pattern the host desk already uses), Room is on deck + the rotation
 * order. Song extras (dedicate, mystery pool, move to top, remove) live in the song action sheet;
 * fight for a spot isn't in it yet — see SongActionSheet's note. */
/** The main queue past on deck: a live forecast from everyone's personal queues (server-side
 * projectUpcoming). Other guests' titles are private (§12), so their slots show only who. Your own
 * slots are drafted in your queue's order, so the nth "you" slot is the nth song in your list. */
function UpcomingList({
  startAt,
  upcoming,
  guestId,
  mySongs,
}: {
  startAt: number;
  upcoming: UpcomingItemView[];
  guestId: string;
  mySongs: { id: string; trackName: string; artistName: string }[];
}) {
  if (upcoming.length === 0) return null;
  let mine = 0;
  return (
    <div className="mt-2 flex flex-col gap-1">
      <h3 className="text-xs uppercase tracking-wide text-accent-300">Coming up · changes live</h3>
      {upcoming.map((slot, i) => {
        const isMe = slot.kind === "guest" && slot.guestId === guestId;
        const song = isMe ? mySongs[mine++] : undefined;
        return (
          <div
            key={i}
            className="flex items-center gap-3 rounded-md p-2"
            style={{ background: isMe ? "rgb(var(--color-accent-700) / 0.4)" : "rgb(var(--color-section))" }}
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-accent-300">{startAt + i}</span>
            <div className="min-w-0 flex-1">
              {slot.kind === "mystery" ? (
                <p className="flex items-center gap-1 truncate text-sm text-accent-200">
                  <Emoji value="🕵️" size={14} /> Mystery pick
                </p>
              ) : slot.kind === "house" ? (
                <p className="flex items-center gap-1 truncate text-sm text-accent-200">
                  <DiceFive size={14} /> House music until someone adds a song
                </p>
              ) : isMe ? (
                <>
                  <p className="truncate text-sm text-accent-100">{song?.trackName ?? "Your next song"}</p>
                  <p className="truncate text-xs text-accent-300">{song ? `${song.artistName} · you` : "you"}</p>
                </>
              ) : (
                <p className="flex items-center gap-1 truncate text-sm text-accent-200">
                  {slot.addedBy && <Emoji value={slot.addedBy.emoji} size={14} />}
                  {slot.addedBy ? `${slot.addedBy.nickname}'s pick` : "A guest's pick"}
                </p>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-accent-300">
        Nothing here is locked yet: reorder your queue and this updates straight away. Each song locks in about
        15 seconds before the one before it ends.
      </p>
    </div>
  );
}

function RotationQueueView({ code, guestId, onShowHistory }: { code: string; guestId: string; onShowHistory: () => void }) {
  const [view, setView] = useState<"mine" | "room">("mine");
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const mine = useRoomStore((s) => s.mine);
  const setMine = useRoomStore((s) => s.setMine);
  const rotationRoom = useRoomStore((s) => s.rotationRoom);
  const myWeight = useRoomStore((s) => s.myWeight);

  const ordered = mine.filter((m) => !m.inPool);
  const pooled = mine.find((m) => m.inPool) ?? null;
  const actionItem = actionsFor ? mine.find((m) => m.id === actionsFor) ?? null : null;

  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function persistOrder(itemIds: string[]) {
    await fetch(`/rooms/${code}/mine/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds }),
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((m) => m.id === active.id);
    const newIndex = ordered.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(ordered, oldIndex, newIndex);
    setMine(pooled ? [...reordered, pooled] : reordered); // optimistic — mine:update confirms it shortly after
    persistOrder(reordered.map((m) => m.id));
  }

  async function pullFromPool(itemId: string) {
    await fetch(`/rooms/${code}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPool: true }),
    });
  }

  const myTurnIndex = rotationRoom?.rotation.findIndex((r) => r.guestId === guestId) ?? -1;
  // Crowd pick: no turn order to count down; say whether your song is up for the vote.
  const onBallot = !!rotationRoom?.ballot?.entries.some((e) => mine.some((m) => m.id === e.itemId));

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-panel p-1" role="tablist">
          <button
            role="tab"
            aria-selected={view === "mine"}
            onClick={() => setView("mine")}
            className="rounded-md py-1.5 text-sm font-semibold transition-colors"
            style={{
              background: view === "mine" ? "rgb(var(--color-accent))" : "transparent",
              color: view === "mine" ? "rgb(var(--color-bg))" : "rgb(var(--color-accent-200))",
            }}
          >
            Mine · {ordered.length}
          </button>
          <button
            role="tab"
            aria-selected={view === "room"}
            onClick={() => setView("room")}
            className="rounded-md py-1.5 text-sm font-semibold transition-colors"
            style={{
              background: view === "room" ? "rgb(var(--color-accent))" : "transparent",
              color: view === "room" ? "rgb(var(--color-bg))" : "rgb(var(--color-accent-200))",
            }}
          >
            Room
          </button>
        </div>
        <button
          onClick={onShowHistory}
          className="ml-2 flex items-center gap-1.5 rounded-full border border-accent-700 px-3 py-1.5 text-xs font-medium text-accent-100"
        >
          <ClockCounterClockwise size={14} />
        </button>
      </div>

      {view === "mine" && (
        <>
          {onBallot && (
            <div className="flex flex-col gap-2 rounded-lg bg-section px-4 py-3 text-accent-100 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
              Your top song is on the ballot — the room votes on what's next
            </div>
          )}
          {!rotationRoom?.ballot && myTurnIndex === 0 && ordered.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg bg-section px-4 py-3 text-accent-100 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
              Your turn is next
              {myWeight && myWeight > 1 && <BoostRow weight={myWeight} />}
            </div>
          )}
          {!rotationRoom?.ballot && myTurnIndex > 0 && (
            <div className="flex flex-col gap-2 rounded-lg bg-section px-4 py-3 text-accent-100 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
              Your turn in ~{myTurnIndex} turn{myTurnIndex === 1 ? "" : "s"}
              {myWeight && myWeight > 1 && <BoostRow weight={myWeight} />}
            </div>
          )}
          {pooled && (
            <div className="flex items-center gap-3 rounded-md bg-section p-2">
              {pooled.albumArtUrl ? (
                <img src={pooled.albumArtUrl} alt="" className="h-11 w-11 rounded" />
              ) : (
                <div className="h-11 w-11 rounded bg-accent-800" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-accent-100">{pooled.trackName}</p>
                <p className="flex items-center gap-1 truncate text-xs text-accent-300">
                  <Emoji value="🕵️" size={12} /> In the mystery pool — only you see this
                </p>
              </div>
              <button
                onClick={() => pullFromPool(pooled.id)}
                className="whitespace-nowrap rounded-full border border-accent-700 px-2.5 py-1 text-xs font-medium text-accent-100"
              >
                Pull back
              </button>
            </div>
          )}
          {ordered.length === 0 && !pooled && (
            <p className="text-accent-300 text-center text-sm">Your queue's empty — add something in Search!</p>
          )}
          <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ordered.map((m) => m.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1">
                {ordered.map((item) => (
                  <SortableMineRow key={item.id} item={item} onOpenActions={setActionsFor} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {actionItem && <SongActionSheet code={code} item={actionItem} onClose={() => setActionsFor(null)} />}
        </>
      )}

      {view === "room" && (
        <>
          <div className="flex flex-col gap-1">
            <h3 className="text-xs uppercase tracking-wide text-accent-300">On deck</h3>
            {(rotationRoom?.onDeck.length ?? 0) <= 1 && (
              <p className="text-accent-300 text-center text-xs">
                The next song locks in about 15 seconds before this one ends. Until then, reorder your queue freely.
              </p>
            )}
            {rotationRoom?.onDeck.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-md bg-section p-2">
                {item.albumArtUrl ? (
                  <img src={item.albumArtUrl} alt="" className="h-11 w-11 rounded" />
                ) : (
                  <div className="h-11 w-11 rounded bg-accent-800" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-accent-100">{item.trackName}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-accent-300">
                    {item.isMystery ? (
                      <>
                        <Emoji value="🕵️" size={12} /> Mystery pick
                      </>
                    ) : item.addedBy ? (
                      <>
                        <Emoji value={item.addedBy.emoji} size={12} /> {item.addedBy.nickname}
                      </>
                    ) : (
                      <>
                        <DiceFive size={12} /> House pick
                      </>
                    )}
                  </p>
                </div>
                {item.locked && (
                  <span className="flex items-center gap-0.5 rounded-full bg-accent-700/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-200">
                    Locked
                  </span>
                )}
              </div>
            ))}
          </div>
          {rotationRoom?.ballot ? (
            <BallotCard code={code} guestId={guestId} ballot={rotationRoom.ballot} />
          ) : (
            <UpcomingList
              startAt={(rotationRoom?.onDeck.length ?? 0) + 1}
              upcoming={rotationRoom?.upcoming ?? []}
              guestId={guestId}
              mySongs={ordered}
            />
          )}
        </>
      )}
    </div>
  );
}

export function QueueTab({ code, guestId }: { code: string; guestId: string }) {
  const [showHistory, setShowHistory] = useState(false);
  const queue = useRoomStore((s) => s.queue);
  const playback = useRoomStore((s) => s.playback);
  const myMysteryIds = useRoomStore((s) => s.myMysteryIds);
  const mode = useRoomStore((s) => s.settings?.mode ?? "shared");
  const isMine = (q: { id: string; addedBy: { id: string } | null }) => q.addedBy?.id === guestId || myMysteryIds.includes(q.id);

  if (mode === "rotation") {
    return (
      <>
        <RotationQueueView code={code} guestId={guestId} onShowHistory={() => setShowHistory(true)} />
        {showHistory && <HistorySheet code={code} onClose={() => setShowHistory(false)} />}
      </>
    );
  }

  const myIndex = queue.findIndex((q) => isMine(q));
  let waitBanner: string | null = null;
  if (myIndex >= 0) {
    const msAhead = queue.slice(0, myIndex).reduce((sum, q) => {
      // Only what's left of the currently playing song counts, not its full duration.
      if (q.status === "playing" && playback) {
        return sum + Math.max(0, q.durationMs - playback.progressMs);
      }
      return sum + q.durationMs;
    }, 0);
    const minutes = Math.max(1, Math.round(msAhead / 60000));
    waitBanner = `Your next song is #${queue[myIndex].position} · ~${minutes} min`;
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-accent-100">Up next</h2>
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-1.5 rounded-full border border-accent-700 px-3 py-1.5 text-xs font-medium text-accent-100"
        >
          <ClockCounterClockwise size={14} /> History
        </button>
      </div>

      {waitBanner && (
        <div className="rounded-lg bg-section px-4 py-3 text-accent-100 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
          {waitBanner}
        </div>
      )}

      {queue.length === 0 && (
        <p className="text-accent-300 text-center text-sm">
          Queue's empty — add something in Search!
        </p>
      )}

      <div className="flex flex-col gap-1">
        {queue.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-md p-2"
            style={{
              background:
                isMine(item)
                  ? "rgb(var(--color-accent-700) / 0.4)"
                  : "rgb(var(--color-section))",
            }}
          >
            <span className="w-5 text-right text-xs text-accent-300 tabular-nums">
              {item.position}
            </span>
            {item.albumArtUrl ? (
              <img src={item.albumArtUrl} alt="" className="h-11 w-11 rounded" />
            ) : (
              <div className="h-11 w-11 rounded bg-accent-800" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-accent-100">{item.trackName}</p>
              <p className="flex items-center gap-1 truncate text-xs text-accent-300">
                {item.mystery ? (
                  <>
                    <Emoji value="🕵️" size={14} /> {isMine(item) ? "Your mystery pick" : "Mystery pick"}
                  </>
                ) : item.addedBy ? (
                  <>
                    <Emoji value={item.addedBy.emoji} size={14} /> {item.addedBy.nickname}
                  </>
                ) : item.source === "fallback" ? (
                  <>
                    <DiceFive size={14} /> House pick
                  </>
                ) : (
                  item.artistName
                )}
              </p>
            </div>
            {item.status === "playing" && (
              <span className="flex items-center gap-1 text-xs text-accent-300">
                <Play size={12} weight="fill" /> playing
              </span>
            )}
            {item.hearts > 0 && (
              <span className="flex items-center gap-1 text-xs text-accent-300">
                <Heart size={12} weight="fill" /> {item.hearts}
              </span>
            )}
            {item.pinnedPosition !== null && (
              <span className="flex items-center gap-0.5 rounded-full bg-accent-700/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-200">
                <PushPin size={9} weight="fill" /> Pinned
              </span>
            )}
            {item.status === "pending" && (
              <span className="flex items-center gap-0.5 rounded-full bg-accent-700/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-200">
                <HourglassMedium size={9} weight="fill" /> Waiting for host
              </span>
            )}
          </div>
        ))}
      </div>

      {showHistory && <HistorySheet code={code} onClose={() => setShowHistory(false)} />}
    </div>
  );
}
