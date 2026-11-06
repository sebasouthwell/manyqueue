import { useEffect, useState } from "react";
import { DiceFive, SkipForward } from "@phosphor-icons/react";
import type { HistoryItemView } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";
import { formatDuration } from "../lib/format";
import { topReaction } from "@manyqueue/shared";
import { HatCover } from "./Holiday";

/** What already played tonight, newest first. Reloads when the song changes so
 * it stays current while it's open. Used in the phone sheet and on the host desk. */
/** `limit` shows only the newest few, with a "Show all" toggle (the host desk keeps this list short). */
export function HistoryList({ code, limit }: { code: string; limit?: number }) {
  const [showAll, setShowAll] = useState(false);
  const [items, setItems] = useState<HistoryItemView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const playingId = useRoomStore((s) => s.queue.find((i) => i.status === "playing")?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/rooms/${code}/history`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => !cancelled && (setItems(data.history), setFailed(false)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [code, playingId]);

  if (failed && !items) return <p className="text-center text-sm text-accent-300">Couldn't load the history.</p>;
  if (!items) return <p className="text-center text-sm text-accent-300">Loading…</p>;
  if (items.length === 0) return <p className="text-center text-sm text-accent-300">Nothing has played yet.</p>;

  const collapsed = limit !== undefined && !showAll && items.length > limit;
  const visible = collapsed ? items.slice(0, limit) : items;
  return (
    <>
    <ul className="flex flex-col gap-1">
      {visible.map((item, i) => (
        <li key={item.id} className="flex items-center gap-3 rounded-md bg-bg p-2">
          <span className="w-6 text-right text-xs tabular-nums text-accent-300">{items.length - i}</span>
          {item.albumArtUrl ? (
            <HatCover trackName={item.trackName} size={44}><img src={item.albumArtUrl} alt="" className="h-11 w-11 rounded" /></HatCover>
          ) : (
            <div className="h-11 w-11 rounded bg-accent-800" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-accent-100">{item.trackName}</p>
            <p className="flex items-center gap-1 truncate text-xs text-accent-300">
              {item.mystery ? (
                <>
                  <Emoji value="🕵️" size={14} /> Mystery pick
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
          {(() => {
            const top = topReaction(item.reactions);
            return top ? (
              <span
                className="flex items-center gap-1 text-xs tabular-nums text-accent-200"
                title={item.topReactor ? `Most reactions from ${item.topReactor.nickname}` : undefined}
              >
                <Emoji value={top.emoji} size={14} /> {top.count}
              </span>
            ) : null;
          })()}
          {item.status === "skipped" ? (
            <span className="flex items-center gap-1 text-xs text-accent-300">
              <SkipForward size={12} weight="fill" /> skipped
            </span>
          ) : (
            <span className="text-xs tabular-nums text-accent-300">{formatDuration(item.durationMs)}</span>
          )}
        </li>
      ))}
    </ul>
    {limit !== undefined && items.length > limit && (
      <button onClick={() => setShowAll((v) => !v)} className="mt-1 self-start text-xs font-semibold text-accent-200 underline-offset-2 hover:underline">
        {showAll ? "Show fewer" : `Show all ${items.length}`}
      </button>
    )}
    </>
  );
}
