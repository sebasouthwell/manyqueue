import { useRoomStore } from "../store/roomStore";

export function HostNowPlayingCard({ code }: { code: string }) {
  const queue = useRoomStore((s) => s.queue);
  const playback = useRoomStore((s) => s.playback);
  const nowPlaying = queue.find((i) => i.status === "playing") ?? null;

  async function pause() {
    await fetch(`/rooms/${code}/playback/pause`, { method: "POST" });
  }
  async function resume() {
    await fetch(`/rooms/${code}/playback/resume`, { method: "POST" });
  }
  async function skip() {
    await fetch(`/rooms/${code}/playback/skip`, { method: "POST" });
  }

  if (!nowPlaying) {
    return (
      <div className="w-full max-w-sm rounded-lg bg-section p-4 text-center text-sm text-accent-300">
        Nothing playing
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-lg bg-section p-4">
      {nowPlaying.albumArtUrl ? (
        <img src={nowPlaying.albumArtUrl} alt="" className="h-14 w-14 rounded" />
      ) : (
        <div className="h-14 w-14 rounded bg-accent-800" />
      )}
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm text-accent-100">{nowPlaying.trackName}</p>
        <p className="truncate text-xs text-accent-300">{nowPlaying.artistName}</p>
      </div>
      <button
        onClick={playback?.isPlaying ? pause : resume}
        className="rounded-md bg-accent px-3 py-2 text-sm text-bg"
      >
        {playback?.isPlaying ? "⏸" : "▶"}
      </button>
      <button
        onClick={skip}
        className="rounded-md border border-accent px-3 py-2 text-sm text-accent-100"
      >
        ⏭
      </button>
    </div>
  );
}
