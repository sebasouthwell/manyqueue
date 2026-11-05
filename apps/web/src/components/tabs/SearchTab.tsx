import { useEffect, useRef, useState } from "react";
import { Coin, ArrowsClockwise, SpeakerSlash, DotsThreeVertical } from "@phosphor-icons/react";
import {
  isUnaffordableForever,
  type AddToQueueResponse,
  type NoTokensResponse,
  type MaxReplaysResponse,
  type PriceChangedResponse,
  type PricedTrackResult,
} from "@manyqueue/shared";
import { formatDuration, ordinal } from "../../lib/format";
import { useRoomStore } from "../../store/roomStore";
import { Dialog } from "../Dialog";
import { AddSheet } from "../AddSheet";
import { BanPicker } from "../BanPicker";
import { SpotifyLimitBanner } from "../SpotifyLimitBanner";

type AddState =
  | { kind: "idle" }
  | { kind: "adding" }
  | { kind: "added"; position: number }
  | { kind: "duplicate"; itemId: string; position: number }
  | { kind: "hearted"; position: number }
  | { kind: "entered" };

const NO_TOKEN_STREAK_FOR_EASTER_EGG = 5;

export function SearchTab({ code }: { code: string }) {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<PricedTrackResult[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addState, setAddState] = useState<Record<string, AddState>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [priceChanged, setPriceChanged] = useState<{
    track: PricedTrackResult;
    cost: number;
    dedication: string | null;
  } | null>(null);
  const [optionsFor, setOptionsFor] = useState<PricedTrackResult | null>(null);
  const [banPicking, setBanPicking] = useState(false);
  const [truthOrDare, setTruthOrDare] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noTokenStreakRef = useRef(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const settings = useRoomStore((s) => s.settings);
  const tokenBalance = useRoomStore((s) => s.tokenBalance);
  const muted = useRoomStore((s) => s.muted);

  async function runSearch(q: string, nextOffset: number, append: boolean) {
    if (q.trim().length < 2) {
      setTracks([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/rooms/${code}/search?q=${encodeURIComponent(q)}&offset=${nextOffset}`,
      );
      if (res.status === 429 || res.status === 503) {
        setError("Search is busy, try again in a moment.");
        return;
      }
      if (!res.ok) {
        setError("Search failed, try again.");
        return;
      }
      const data = await res.json();
      setTracks((prev) => (append ? [...prev, ...data.tracks] : data.tracks));
      setTotal(data.total);
      setOffset(nextOffset);
    } catch {
      setError("Search failed, check your connection.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(query, 0, false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [cooldownUntil]);
  // The add cooldown is a Shared-mode anti-spam setting (Rotation mode has no per-add throttle — D2:
  // adding is free, up to the personal queue cap). Rotation never sets this, but it doesn't read it
  // either, so stale state from before a mode switch can't linger and block the Add button here.
  const cooldownMs = settings?.mode === "rotation" ? 0 : Math.max(0, cooldownUntil - now);

  function showToast(message: string) {
    setToast(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  }

  function registerNoTokenAttempt() {
    noTokenStreakRef.current += 1;
    if (noTokenStreakRef.current >= NO_TOKEN_STREAK_FOR_EASTER_EGG) {
      noTokenStreakRef.current = 0;
      setTruthOrDare(true);
    }
  }

  /** Returns a message to show next to the option that failed (a rejected dedication), else null. */
  async function submitAdd(track: PricedTrackResult, expectedCost: number, dedication: string | null = null, anonymous = false): Promise<string | null> {
    setAddState((prev) => ({ ...prev, [track.uri]: { kind: "adding" } }));
    try {
      const res = await fetch(`/rooms/${code}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackUri: track.uri,
          name: track.name,
          artistName: track.artistName,
          albumArtUrl: track.albumArtUrl,
          durationMs: track.durationMs,
          explicit: track.explicit,
          expectedCost,
          ...(dedication ? { dedication } : {}),
          ...(anonymous ? { anonymous: true } : {}),
        }),
      });
      if (res.status === 402) {
        const body = await res.json();
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
        if (body.error === "max_replays") {
          const maxReplays: MaxReplaysResponse = body;
          showToast(`Max replays reached (cap ${maxReplays.tokenCap})`);
        } else {
          const noTokens: NoTokensResponse = body;
          showToast(`Not enough tokens — needs ${noTokens.cost}`);
        }
        registerNoTokenAttempt();
        return null;
      }
      if (res.status === 429) {
        const body = await res.json();
        if (body.error === "cooldown") {
          setCooldownUntil(Date.now() + body.retryAfterMs);
          setNow(Date.now());
          setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
          return null;
        }
      }
      if (res.status === 400) {
        const body = await res.json().catch(() => null);
        if (body?.error === "banned") {
          setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
          showToast("That song is banned tonight.");
          return null;
        }
        if (body?.error === "in_contest_pool") {
          setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
          showToast("That song is waiting in the contest.");
          return null;
        }
        if (body?.error === "dedication_rejected") {
          setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
          return body.message ?? "That dedication didn't work.";
        }
        if (body?.error === "rule_violation") {
          setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
          showToast(body.rule === "too_long" ? "That song is too long for this room." : "Explicit songs aren't allowed here.");
          return null;
        }
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
        return null;
      }
      if (res.status === 409) {
        const priceChangedRes: PriceChangedResponse = await res.json();
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
        setPriceChanged({ track, cost: priceChangedRes.cost, dedication });
        return null;
      }
      if (!res.ok) {
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
        return null;
      }
      const data: AddToQueueResponse = await res.json();
      if (data.status === "added") {
        if (anonymous || data.item.mystery) useRoomStore.getState().rememberMyMystery(data.item.id);
        setAddState((prev) => ({
          ...prev,
          [track.uri]: { kind: "added", position: data.item.position },
        }));
        showToast(`Added · #${data.item.position}`);
        if (settings && settings.addCooldownSec > 0) {
          setCooldownUntil(Date.now() + settings.addCooldownSec * 1000);
          setNow(Date.now());
        }
      } else {
        setAddState((prev) => ({
          ...prev,
          [track.uri]: {
            kind: "duplicate",
            itemId: data.item.id,
            position: data.item.position,
          },
        }));
      }
      return null;
    } catch {
      setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
      return null;
    }
  }

  /** Rotation mode: adds to the guest's own queue instead — always free, no pricing/duplicate/cooldown
   * dance (D2, D3 — extras like dedication are set afterwards from the song action sheet, not here). */
  async function submitMineAdd(track: PricedTrackResult): Promise<void> {
    setAddState((prev) => ({ ...prev, [track.uri]: { kind: "adding" } }));
    try {
      const res = await fetch(`/rooms/${code}/mine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackUri: track.uri,
          name: track.name,
          artistName: track.artistName,
          albumArtUrl: track.albumArtUrl,
          durationMs: track.durationMs,
          explicit: track.explicit,
        }),
      });
      if (res.status === 400) {
        const body = await res.json().catch(() => null);
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
        if (body?.error === "queue_full") showToast(`Your queue is full (max ${body.cap})`);
        else if (body?.error === "rule_violation") {
          showToast(body.rule === "too_long" ? "That song is too long for this room." : "Explicit songs aren't allowed here.");
        }
        return;
      }
      if (!res.ok) {
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
        return;
      }
      const mineCount = useRoomStore.getState().mine.filter((m) => !m.inPool).length;
      setAddState((prev) => ({ ...prev, [track.uri]: { kind: "added", position: mineCount + 1 } }));
    } catch {
      setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
    }
  }

  /** Puts the song in the contest pool instead of the queue. Returns a message for the sheet, or null. */
  async function submitContest(track: PricedTrackResult): Promise<string | null> {
    setAddState((prev) => ({ ...prev, [track.uri]: { kind: "adding" } }));
    const back = () => setAddState((prev) => ({ ...prev, [track.uri]: { kind: "idle" } }));
    try {
      const res = await fetch(`/rooms/${code}/contest/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackUri: track.uri,
          name: track.name,
          artistName: track.artistName,
          albumArtUrl: track.albumArtUrl,
          durationMs: track.durationMs,
          explicit: track.explicit,
        }),
      });
      if (res.ok) {
        setAddState((prev) => ({ ...prev, [track.uri]: { kind: "entered" } }));
        showToast("Entered the song contest 🏆");
        return null;
      }
      back();
      const body = await res.json().catch(() => null);
      if (body?.error === "no_tokens") return "Not enough tokens to enter.";
      if (body?.error === "already_entered") return "You already have a song waiting in the contest.";
      if (body?.error === "duplicate") return "That song is already in the queue or the contest.";
      if (body?.error === "rule_violation") {
        return body.rule === "too_long" ? "That song is too long for this room." : "Explicit songs aren't allowed here.";
      }
      if (body?.error === "muted") return "You've been muted, so you can't enter songs.";
      if (body?.error === "banned") return "That song is banned tonight.";
      return "Couldn't enter the contest. Try again.";
    } catch {
      back();
      return "Couldn't enter the contest. Check your connection.";
    }
  }

  async function handleTap(track: PricedTrackResult) {
    const current = addState[track.uri] ?? { kind: "idle" };

    if (current.kind === "idle") {
      if (settings?.mode === "rotation") {
        await submitMineAdd(track);
      } else {
        await submitAdd(track, track.price);
      }
      return;
    }

    if (current.kind === "duplicate") {
      const res = await fetch(`/rooms/${code}/queue/${current.itemId}/heart`, {
        method: "POST",
      });
      if (res.ok) {
        setAddState((prev) => ({
          ...prev,
          [track.uri]: { kind: "hearted", position: current.position },
        }));
      }
    }
  }

  function buttonLabel(track: PricedTrackResult) {
    const state = addState[track.uri] ?? { kind: "idle" };
    switch (state.kind) {
      case "idle":
        if (track.banned) return "🚫 Banned tonight";
        if (track.rule) return track.rule === "too_long" ? "Too long" : "Explicit";
        if (cooldownMs > 0) return formatDuration(cooldownMs);
        if (track.price <= 0) return "Add";
        return (
          <span className="flex items-center gap-1">
            {track.playsTonight > 0 ? <ArrowsClockwise size={12} /> : "Add"}{" "}
            <Coin size={12} weight="fill" /> {track.price}
          </span>
        );
      case "adding":
        return "…";
      case "added":
        return `✓ #${state.position}`;
      case "duplicate":
        return `In queue #${state.position} · ❤️ Want this too`;
      case "hearted":
        return "❤️ Added";
      case "entered":
        return "🏆 In contest";
    }
  }

  return (
    <div className="relative flex flex-col gap-4 px-4 py-4">
      {muted && (
        <div className="fixed inset-x-0 bottom-16 top-14 z-30 flex items-center justify-center bg-bg/90 px-8 text-center backdrop-blur-sm">
          <div className="flex max-w-xs flex-col items-center gap-3">
            <SpeakerSlash size={40} className="text-accent-300" />
            <p className="text-lg font-semibold text-accent-100">Sorry, you've been muted</p>
            <p className="text-sm text-accent-300">
              You can still vote and react, but you can't add songs right now.
            </p>
          </div>
        </div>
      )}
      <SpotifyLimitBanner audience="guest" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a song…"
        className="rounded-full bg-section px-5 py-3 text-accent-100 outline-none"
      />

      {toast && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg shadow-lg">
          {toast}
        </div>
      )}

      {error && <p className="text-danger text-sm text-center">{error}</p>}

      <div className="flex flex-col gap-2">
        {tracks.map((track) => {
          const state = addState[track.uri] ?? { kind: "idle" };
          const isIdle = state.kind === "idle";
          const forever = settings ? isUnaffordableForever(track.price, settings.tokenCap) : false;
          const shortOnBalance =
            isIdle && !forever && tokenBalance !== null && tokenBalance < track.price;
          const unaffordable = isIdle && (forever || shortOnBalance);
          // Still tappable when unaffordable — the server is authoritative on
          // balance, and every genuine attempt counts toward the "5 tries" easter egg.
          const ruleBlocked = isIdle && !!track.rule;
          const banned = !!track.banned;
          const coolingDown = isIdle && !track.rule && !banned && cooldownMs > 0;
          const disabled =
            state.kind === "adding" || state.kind === "added" || state.kind === "hearted" || state.kind === "entered" || banned || ruleBlocked || coolingDown;
          return (
            <div key={track.uri} className="flex items-center gap-3 rounded-md bg-section p-2" style={banned ? { opacity: 0.45 } : undefined}>
              {track.albumArtUrl ? (
                <img src={track.albumArtUrl} alt="" className="h-12 w-12 rounded" />
              ) : (
                <div className="h-12 w-12 rounded bg-accent-800" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-accent-100">{track.name}</p>
                <p className="truncate text-accent-300 text-sm">
                  {track.playsTonight > 0
                    ? `↻ Replay · ${ordinal(track.playsTonight + 1)} play`
                    : track.artistName}
                </p>
              </div>
              <span className="text-accent-300 text-xs tabular-nums">
                {formatDuration(track.durationMs)}
              </span>
              {isIdle && !ruleBlocked && !banned && !muted && settings?.mode !== "rotation" && (
                <button
                  onClick={() => setOptionsFor(track)}
                  aria-label={`More options for ${track.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-accent-200"
                >
                  <DotsThreeVertical size={20} weight="bold" />
                </button>
              )}
              <div className="flex flex-col items-end gap-0.5">
                <button
                  onClick={() => handleTap(track)}
                  disabled={disabled}
                  className="whitespace-nowrap rounded-full border border-accent px-3 py-1.5 text-xs text-accent-100 disabled:opacity-60"
                  style={unaffordable || ruleBlocked || coolingDown ? { opacity: 0.45 } : undefined}
                >
                  {buttonLabel(track)}
                </button>
                {shortOnBalance && !ruleBlocked && <span className="text-accent-300 text-[10px]">Out of tokens</span>}
                {ruleBlocked && (
                  <span className="text-accent-300 text-[10px]">
                    {track.rule === "too_long" ? "Over this room's length limit" : "Explicit songs are off"}
                  </span>
                )}
                {forever && isIdle && !ruleBlocked && (
                  <span className="text-accent-300 text-[10px]">Max replays reached</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {loading && <p className="text-accent-300 text-center text-sm">Searching…</p>}

      {!loading && tracks.length > 0 && offset + tracks.length < total && (
        <button
          onClick={() => runSearch(query, offset + 10, true)}
          className="rounded-md border border-accent px-4 py-2 text-sm text-accent-100"
        >
          Load more
        </button>
      )}

      {optionsFor && (
        <AddSheet
          code={code}
          track={optionsFor}
          onCallBan={() => {
            setOptionsFor(null);
            setBanPicking(true);
          }}
          onClose={() => setOptionsFor(null)}
          onConfirm={async ({ dedication, cost, contest, anonymous }) => {
            const error = contest ? await submitContest(optionsFor) : await submitAdd(optionsFor, cost, dedication, anonymous);
            if (!error) setOptionsFor(null);
            return error;
          }}
        />
      )}

      {banPicking && <BanPicker code={code} onClose={() => setBanPicking(false)} />}

      {priceChanged && (
        <Dialog
          title="The price went up"
          body={
            <>
              Someone else just played this one — it's now{" "}
              <span className="inline-flex items-center gap-1 font-semibold text-accent-100">
                <Coin size={14} weight="fill" /> {priceChanged.cost}
              </span>
              .
            </>
          }
          primaryLabel={`Add for ${priceChanged.cost} 🪙`}
          onPrimary={() => {
            const { track, cost, dedication } = priceChanged;
            setPriceChanged(null);
            submitAdd({ ...track, price: cost }, cost, dedication);
          }}
          secondaryLabel="Keep my tokens"
          onSecondary={() => setPriceChanged(null)}
        />
      )}

      {truthOrDare && (
        <Dialog
          title="🎭 Truth or Dare!"
          body="You've tried 5 times with no tokens — get the group to give you a Truth or Dare, then ask the host for one."
          primaryLabel="Got it"
          onPrimary={() => setTruthOrDare(false)}
        />
      )}
    </div>
  );
}
