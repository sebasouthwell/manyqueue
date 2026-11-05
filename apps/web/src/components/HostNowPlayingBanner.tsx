import { DiceFive, Pause, Play, SkipForward } from "@phosphor-icons/react";
import { useRoomStore } from "../store/roomStore";
import { useAnimatedProgress } from "../hooks/useAnimatedProgress";
import { formatDuration } from "../lib/format";
import { VinylDisc } from "./VinylDisc";
import { DedicationControl } from "./DedicationControl";
import { VolumeSlider } from "./VolumeSlider";
import { Emoji } from "./Emoji";

/** Full-width now-playing strip across the top of the host desk. It's the same
 * on every section, so it lives above the panels rather than inside one. */
export function HostNowPlayingBanner({ code }: { code: string }) {
  const queue = useRoomStore((s) => s.queue);
  const playback = useRoomStore((s) => s.playback);
  const clockOffsetMs = useRoomStore((s) => s.clockOffsetMs);
  const nowPlaying = queue.find((i) => i.status === "playing") ?? null;
  const progressMs = useAnimatedProgress(playback, clockOffsetMs);

  const post = (action: "pause" | "resume" | "skip") => () =>
    fetch(`/rooms/${code}/playback/${action}`, { method: "POST" });

  if (!nowPlaying) {
    return (
      <div className="rounded-lg bg-section px-6 py-5 text-sm text-accent-300">Nothing playing</div>
    );
  }

  const durationMs = playback?.durationMs || nowPlaying.durationMs || 0;
  const pct = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;

  return (
    <div className="flex items-center gap-5 rounded-lg bg-section p-4 shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
      <VinylDisc artUrl={nowPlaying.albumArtUrl} spinning={!!playback?.isPlaying} size={112} />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs uppercase tracking-wide text-accent-300">Now playing</p>
        <p className="truncate text-2xl font-bold text-accent-100">{nowPlaying.trackName}</p>
        <p className="truncate text-base text-accent-200">{nowPlaying.artistName}</p>
        {nowPlaying.mystery ? (
          <p className="flex items-center gap-1.5 text-xs text-accent-300">
            Added by <Emoji value="🕵️" size={14} /> Mystery pick
          </p>
        ) : nowPlaying.addedBy ? (
          <p className="flex items-center gap-1.5 text-xs text-accent-300">
            Added by <Emoji value={nowPlaying.addedBy.emoji} size={14} /> {nowPlaying.addedBy.nickname}
          </p>
        ) : nowPlaying.source === "fallback" ? (
          <p className="flex items-center gap-1.5 text-xs text-accent-300">
            <DiceFive size={14} /> House pick
          </p>
        ) : null}
        <DedicationControl code={code} item={nowPlaying} />
        <div className="mt-3 flex items-center gap-3 text-xs tabular-nums text-accent-300">
          <span className="w-10 text-right">{formatDuration(progressMs)}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-800">
            <div className="h-full rounded-full bg-accent-300" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-10">{formatDuration(durationMs)}</span>
        </div>
      </div>
      <div className="w-44 shrink-0">
        <VolumeSlider code={code} />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={post(playback?.isPlaying ? "pause" : "resume")}
          aria-label={playback?.isPlaying ? "Pause" : "Play"}
          className="grid h-12 w-12 place-items-center rounded-full border border-accent text-accent-100 hover:bg-accent-700/40"
        >
          {playback?.isPlaying ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" />}
        </button>
        <button
          onClick={post("skip")}
          aria-label="Skip"
          className="grid h-12 w-12 place-items-center rounded-full border border-accent text-accent-100"
        >
          <SkipForward size={20} weight="fill" />
        </button>
      </div>
    </div>
  );
}
