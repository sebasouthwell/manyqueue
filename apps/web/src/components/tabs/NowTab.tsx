import { useEffect, useState } from "react";
import { DiceFive, Skull, Check, SpotifyLogo, Heart, VinylRecord, Image as ImageIcon, SkipForward, Play, Pause } from "@phosphor-icons/react";
import { VOTE_SKIP_OPENS_AFTER_MS } from "@manyqueue/shared";
import { Crossfade } from "../Crossfade";
import { Emoji } from "../Emoji";
import { ReactionBar } from "../ReactionBar";
import { VinylDisc } from "../VinylDisc";
import { useCan } from "../../hooks/useCan";
import { VolumeSlider } from "../VolumeSlider";
import { BallotCard } from "../BallotCard";
import { useAnimatedProgress } from "../../hooks/useAnimatedProgress";
import { useRoomStore } from "../../store/roomStore";
import { formatDuration, spotifyTrackUrl } from "../../lib/format";

const VINYL_KEY = "manyqueue_vinyl";

// The record is the default; only an explicit flip to album art ("0") is remembered as different.
function loadVinyl(): boolean {
  try {
    return localStorage.getItem(VINYL_KEY) !== "0";
  } catch {
    return true;
  }
}

interface VoteInfo {
  targetQueueItemId: string;
  count: number;
  threshold: number;
  voted: boolean;
}

function formatCountdown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `0:${seconds.toString().padStart(2, "0")}`;
}

export function NowTab({ code, guestId }: { code: string; guestId: string }) {
  const queue = useRoomStore((s) => s.queue);
  const playback = useRoomStore((s) => s.playback);
  const clockOffsetMs = useRoomStore((s) => s.clockOffsetMs);
  const voteTally = useRoomStore((s) => s.voteTally);
  const progressMs = useAnimatedProgress(playback, clockOffsetMs);

  const nowPlaying = queue.find((item) => item.status === "playing") ?? null;
  const rotationRoom = useRoomStore((s) => s.rotationRoom);
  const ballot = rotationRoom?.ballot ?? null;
  const pickedByCrowd = !!nowPlaying && !!rotationRoom?.onDeck.find((o) => o.id === nowPlaying.id)?.pickedByCrowd;
  const [vote, setVote] = useState<VoteInfo | null>(null);
  const [voting, setVoting] = useState(false);
  const canSkip = useCan("skip");
  const canPlayback = useCan("playback");
  const canVolume = useCan("volume");
  const [skipping, setSkipping] = useState(false);
  async function skipNow() {
    setSkipping(true);
    try {
      await fetch(`/rooms/${code}/playback/skip`, { method: "POST" });
    } finally {
      setSkipping(false);
    }
  }
  // Tap the art to swap between the album cover and a spinning record; remembered on this device.
  const [vinyl, setVinyl] = useState(loadVinyl);
  function toggleVinyl() {
    setVinyl((v) => {
      try {
        localStorage.setItem(VINYL_KEY, v ? "0" : "1");
      } catch {
        // storage blocked: the choice lasts until reload
      }
      return !v;
    });
  }

  // Derived from the same synced progressMs the ring uses (Block 7/8's poll ->
  // playback:update -> useAnimatedProgress chain), not an independent timer — a
  // separate setInterval here would drift (backgrounded phone tabs throttle
  // timers) and duplicate a clock we already keep correct. The server remains the
  // real authority (queue_items.startedAt) for whether a vote is actually accepted.
  const opensInMs = Math.max(0, VOTE_SKIP_OPENS_AFTER_MS - progressMs);

  useEffect(() => {
    if (!nowPlaying) {
      setVote(null);
      return;
    }
    fetch(`/rooms/${code}/votes/current`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.vote && setVote(data.vote))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.id]);

  useEffect(() => {
    if (!voteTally || !nowPlaying || voteTally.targetQueueItemId !== nowPlaying.id) return;
    setVote((prev) => ({
      targetQueueItemId: voteTally.targetQueueItemId,
      count: voteTally.count,
      threshold: voteTally.threshold,
      voted: voteTally.skipped ? false : (prev?.voted ?? false),
    }));
  }, [voteTally, nowPlaying]);

  async function castVote() {
    setVoting(true);
    try {
      const res = await fetch(`/rooms/${code}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "skip" }),
      });
      if (res.ok) {
        const data = await res.json();
        setVote((prev) =>
          prev
            ? { ...prev, count: data.count, threshold: data.threshold, voted: data.voted }
            : prev,
        );
      }
    } finally {
      setVoting(false);
    }
  }

  if (!nowPlaying) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8 px-8 text-center">
        <p className="text-accent-200">Nothing playing right now. Add something! 🎶</p>
        {/* Reactions still go to the TV, so keep them here even between songs. */}
        <ReactionBar />
      </div>
    );
  }

  const durationMs = nowPlaying.durationMs;
  const progressPct = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;
  const votingOpen = opensInMs <= 0;
  const spotifyUrl = spotifyTrackUrl(nowPlaying.trackUri);

  return (
    <Crossfade trackKey={nowPlaying.trackUri}>
      <div className="flex flex-col items-center gap-5 px-8 py-6">
        <button
          onClick={toggleVinyl}
          aria-pressed={vinyl}
          aria-label={vinyl ? "Showing the record. Tap for album art." : "Showing album art. Tap for the record."}
          className="relative rounded-full p-2.5"
          style={{
            width: 280,
            height: 280,
            background: `conic-gradient(rgb(var(--color-accent-300)) 0 ${progressPct}%, rgb(var(--color-accent-900)) ${progressPct}% 100%)`,
            boxShadow: "0 0 60px rgb(var(--color-accent-600) / 0.5)",
          }}
        >
          {vinyl ? (
            <VinylDisc artUrl={nowPlaying.albumArtUrl} spinning={!!playback?.isPlaying} size={260} />
          ) : nowPlaying.albumArtUrl ? (
            <img
              src={nowPlaying.albumArtUrl}
              alt=""
              className="h-full w-full rounded-full"
              style={{ boxShadow: "0 0 0 6px rgb(var(--color-section))" }}
            />
          ) : (
            <div
              className="h-full w-full rounded-full bg-gradient-to-br from-accent-700 to-accent-900"
              style={{ boxShadow: "0 0 0 6px rgb(var(--color-section))" }}
            />
          )}
          <span className="absolute bottom-1 right-1 grid h-8 w-8 place-items-center rounded-full bg-section text-accent-200 shadow-lg">
            {vinyl ? <ImageIcon size={16} /> : <VinylRecord size={16} />}
          </span>
        </button>

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-2xl font-medium text-accent-100">{nowPlaying.trackName}</p>
          <p className="text-accent-200 text-sm">
            {nowPlaying.artistName} · {formatDuration(progressMs)} of {formatDuration(durationMs)}
          </p>
          {nowPlaying.mystery ? (
            <p className="flex items-center gap-1 text-accent-300 text-xs">
              Added by <Emoji value="🕵️" size={14} /> Mystery pick
            </p>
          ) : nowPlaying.addedBy ? (
            <p className="flex items-center gap-1 text-accent-300 text-xs">
              {pickedByCrowd ? "Picked by the crowd · from" : "Added by"} <Emoji value={nowPlaying.addedBy.emoji} size={14} /> {nowPlaying.addedBy.nickname}
            </p>
          ) : nowPlaying.source === "fallback" ? (
            <p className="flex items-center gap-1 text-accent-300 text-xs">
              <DiceFive size={14} /> House pick
            </p>
          ) : null}
          {nowPlaying.dedication && (
            <p className="mt-1 flex max-w-[280px] items-center justify-center gap-1.5 text-center text-sm text-accent-100">
              <Heart size={14} weight="fill" className="shrink-0 text-accent-300" />
              <span className="break-words">{nowPlaying.dedication}</span>
            </p>
          )}
          {spotifyUrl && (
            <a
              href={spotifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent-700 px-3 py-1.5 text-xs font-medium text-accent-100"
            >
              <SpotifyLogo size={16} weight="fill" /> Open in Spotify
            </a>
          )}
        </div>

        <ReactionBar />

        {ballot && <BallotCard code={code} guestId={guestId} ballot={ballot} />}

        <button
          onClick={castVote}
          disabled={!votingOpen || voting}
          className="flex min-h-[48px] w-full items-center justify-between rounded-2xl px-4 text-accent-100 shadow-[inset_0_0_0_1px_rgb(var(--color-accent-500))] disabled:opacity-50"
          style={{
            background: vote?.voted ? "rgb(var(--color-accent-700) / 0.4)" : "transparent",
          }}
        >
          <span className="flex items-center gap-1.5">
            {vote?.voted ? (
              <>
                <Check size={16} weight="bold" /> Voted to skip
              </>
            ) : (
              <>
                <Skull size={16} /> Vote to skip
              </>
            )}
          </span>
          <span className="text-accent-200 text-xs">
            {votingOpen
              ? vote
                ? `${vote.count} of ${vote.threshold}`
                : ""
              : `Voting opens in ${formatCountdown(opensInMs)}`}
          </span>
        </button>

        {(canPlayback || canSkip) && (
          <div className="flex w-full gap-2">
            {canPlayback && (
              <button
                onClick={() => fetch(`/rooms/${code}/playback/${playback?.isPlaying ? "pause" : "resume"}`, { method: "POST" }).catch(() => {})}
                className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border border-accent px-4 font-semibold text-accent-100"
              >
                {playback?.isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
                {playback?.isPlaying ? "Pause" : "Play"}
              </button>
            )}
            {canSkip && (
              <button
                onClick={skipNow}
                disabled={skipping}
                className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-accent px-4 font-semibold text-bg disabled:opacity-50"
              >
                <SkipForward size={18} weight="fill" /> {skipping ? "Skipping…" : "Skip"}
              </button>
            )}
          </div>
        )}
        {canVolume && <VolumeSlider code={code} />}
      </div>
    </Crossfade>
  );
}
