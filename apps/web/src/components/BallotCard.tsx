import { useEffect, useMemo, useState } from "react";
import { Check, Fire } from "@phosphor-icons/react";
import type { BallotView } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";

/** A stable per-phone order (§6: "shuffled differently for each voter"): the same seed gives the same
 * order on every update, so rows don't jump about while the counts change. */
function shuffleFor<T extends { itemId: string }>(items: T[], seed: string): T[] {
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return [...items].sort((a, b) => hash(seed + a.itemId) - hash(seed + b.itemId));
}

function useCountdown(closesAt: number | null): number | null {
  const clockOffsetMs = useRoomStore((s) => s.clockOffsetMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (closesAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [closesAt]);
  if (closesAt === null) return null;
  return Math.max(0, Math.round((closesAt - (now + (clockOffsetMs ?? 0))) / 1000));
}

export function formatSecs(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

/** Crowd pick's "Pick what's next" card (mockup 4f): everyone's top song, no names, one vote you can
 * change until it closes. Your own song is marked "Yours" on your phone only, and you can vote for it. */
export function BallotCard({ code, guestId, ballot }: { code: string; guestId: string; ballot: BallotView }) {
  const mine = useRoomStore((s) => s.mine);
  const myIds = useMemo(() => new Set(mine.map((m) => m.id)), [mine]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secs = useCountdown(ballot.closesAt);
  const entries = useMemo(() => shuffleFor(ballot.entries, `${guestId}:${ballot.id}`), [ballot.entries, guestId, ballot.id]);

  useEffect(() => {
    let live = true;
    setMyVote(null);
    fetch(`/rooms/${code}/ballot/vote`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { vote: { ballotId: string; itemId: string } | null } | null) => {
        if (live && j?.vote?.ballotId === ballot.id) setMyVote(j.vote.itemId);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [code, ballot.id]);

  async function vote(itemId: string) {
    const previous = myVote;
    setMyVote(itemId);
    setError(null);
    const res = await fetch(`/rooms/${code}/ballot/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    }).catch(() => null);
    if (!res?.ok) {
      setMyVote(previous);
      setError(res?.status === 400 ? "That vote has closed." : "Couldn't vote — try again.");
    }
  }

  const max = Math.max(1, ...ballot.entries.map((e) => e.votes));

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-section p-3 text-left shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-accent-100">Pick what's next</p>
        <p className="text-xs tabular-nums text-accent-300">
          {secs === null ? "Vote open" : secs > 0 ? `Closes in ${formatSecs(secs)}` : "Closing…"} · {ballot.totalVotes} vote
          {ballot.totalVotes === 1 ? "" : "s"}
        </p>
      </div>
      {entries.map((e) => {
        const chosen = myVote === e.itemId;
        const yours = myIds.has(e.itemId);
        return (
          <button
            key={e.itemId}
            type="button"
            onClick={() => vote(e.itemId)}
            aria-pressed={chosen}
            className="relative flex items-center gap-2.5 overflow-hidden rounded-md p-2 text-left"
            style={{ background: chosen ? "rgb(var(--color-accent-700) / 0.55)" : "rgb(var(--color-bg))" }}
          >
            <span
              className="absolute inset-y-0 left-0 bg-accent-600/25 transition-[width] duration-500"
              style={{ width: `${(e.votes / max) * 100}%` }}
              aria-hidden
            />
            {e.albumArtUrl ? (
              <img src={e.albumArtUrl} alt="" className="relative h-10 w-10 shrink-0 rounded" />
            ) : (
              <div className="relative h-10 w-10 shrink-0 rounded bg-accent-800" />
            )}
            <div className="relative min-w-0 flex-1">
              <p className="truncate text-sm text-accent-100">{e.trackName}</p>
              <p className="flex items-center gap-1.5 truncate text-xs text-accent-300">
                {e.artistName}
                {e.isMystery && (
                  <span className="flex items-center gap-0.5">
                    · <Emoji value="🕵️" size={11} /> mystery
                  </span>
                )}
                {e.lostRounds !== null && e.lostRounds > 0 && <span>· waited {e.lostRounds} round{e.lostRounds === 1 ? "" : "s"}</span>}
              </p>
            </div>
            <div className="relative flex shrink-0 items-center gap-1.5">
              {e.isWildcard && (
                <span className="flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase text-bg">
                  <Fire size={10} weight="fill" /> Wildcard
                </span>
              )}
              {yours && (
                <span className="rounded-full bg-accent-700/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-100">Yours</span>
              )}
              <span className="w-5 text-right text-xs tabular-nums text-accent-200">{e.votes}</span>
              {chosen && <Check size={14} weight="bold" className="text-accent-100" />}
            </div>
          </button>
        );
      })}
      {error && <p className="text-xs text-accent-200">{error}</p>}
      <p className="text-[10px] text-accent-300">No names until it plays. You can change your vote until it closes, and vote for your own.</p>
    </div>
  );
}
