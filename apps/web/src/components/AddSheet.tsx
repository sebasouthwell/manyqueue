import { useEffect, useState } from "react";
import { Coin, Heart, Prohibit, Trophy, Detective } from "@phosphor-icons/react";
import {
  ANONYMOUS_COST,
  CONTEST_ENTRY_COST,
  banCooldownLabel,
  DEDICATION_COST,
  DEDICATION_MAX_LENGTH,
  checkDedication,
  type PricedTrackResult,
} from "@manyqueue/shared";
import { Sheet } from "./Sheet";
import { useRoomStore } from "../store/roomStore";

interface Props {
  code: string;
  track: PricedTrackResult;
  /** Opens the "which song?" picker for a ban vote. */
  onCallBan: () => void;
  onClose: () => void;
  /** Resolves to an error message to show in the sheet, or null when it went through. */
  onConfirm: (options: { dedication: string | null; cost: number; contest: boolean; anonymous: boolean }) => Promise<string | null>;
}

/** Everything you can do when adding a song beyond the plain one-tap add.
 * Each option shows what it costs; later games (contest, anonymous) join it. */
export function AddSheet({ code, track, onCallBan, onClose, onConfirm }: Props) {
  const tokenMode = useRoomStore((s) => s.settings?.tokenMode ?? false);
  const guessWho = useRoomStore((s) => s.settings?.guessWhoMode ?? false);
  const balance = useRoomStore((s) => s.tokenBalance);
  const [dedicate, setDedicate] = useState(false);
  const [contest, setContest] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [banWaitMs, setBanWaitMs] = useState(0);
  const [banRunning, setBanRunning] = useState(false);
  const [spacingSongs, setSpacingSongs] = useState(0);

  useEffect(() => {
    fetch(`/rooms/${code}/ban/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setBanWaitMs(d.retryAfterMs ?? 0);
        setBanRunning(!!d.running);
        setSpacingSongs(d.spacingSongs ?? 0);
      })
      .catch(() => {});
  }, [code]);

  const length = Array.from(text).length;
  const checked = dedicate && text.trim() ? checkDedication(text) : null;
  const error = serverError;

  const dedicationCost = dedicate && tokenMode ? DEDICATION_COST : 0;
  // Contest entries are mystery picks only in Guess Who mode; the anonymous fee applies to ordinary adds.
  const anonymousCost = anonymous && !contest && !guessWho && tokenMode ? ANONYMOUS_COST : 0;
  const total = contest ? (tokenMode ? CONTEST_ENTRY_COST : 0) : track.price + dedicationCost + anonymousCost;
  const short = tokenMode && balance !== null && balance < total;
  const canSubmit = !busy && (contest || !dedicate || (checked?.ok ?? false)) && !short;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setServerError(null);
    const dedication = !contest && dedicate && checked?.ok ? checked.text : null;
    const result = await onConfirm({ dedication, cost: total, contest, anonymous: anonymous && !contest });
    setBusy(false);
    if (result) setServerError(result);
  }

  return (
    <Sheet label="Add song options" onClose={onClose}>
      <div className="mb-4 flex items-center gap-3">
        {track.albumArtUrl ? (
          <img src={track.albumArtUrl} alt="" className="h-12 w-12 rounded" />
        ) : (
          <div className="h-12 w-12 rounded bg-accent-800" />
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-accent-100">{track.name}</p>
          <p className="truncate text-sm text-accent-300">{track.artistName}</p>
        </div>
      </div>

      <button
        onClick={() => {
          setContest((c) => !c);
          setServerError(null);
        }}
        aria-pressed={contest}
        className="mb-3 flex w-full items-center justify-between gap-3 rounded-lg bg-bg px-4 py-3 text-left"
        style={{ boxShadow: contest ? "0 0 0 2px rgb(var(--color-accent))" : "0 0 0 1px rgb(var(--color-accent-700))" }}
      >
        <span className="flex flex-col">
          <span className="flex items-center gap-2 text-accent-100">
            <Trophy size={18} weight={contest ? "fill" : "regular"} className="text-accent-300" />
            Add to song contest
          </span>
          <span className="text-xs text-accent-300">
            {tokenMode ? `${CONTEST_ENTRY_COST} token, refunded if you win.` : "Free."} Goes head to head for the next spot.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm text-accent-300">
          {tokenMode ? (
            <>
              {CONTEST_ENTRY_COST} <Coin size={13} weight="fill" />
            </>
          ) : (
            "free"
          )}
        </span>
      </button>

      <button
        disabled={contest}
        onClick={() => setDedicate((d) => !d)}
        aria-pressed={dedicate}
        className="mb-3 flex w-full items-center justify-between rounded-lg bg-bg px-4 py-3 text-left disabled:opacity-40"
        style={{ boxShadow: dedicate ? "0 0 0 2px rgb(var(--color-accent))" : "0 0 0 1px rgb(var(--color-accent-700))" }}
      >
        <span className="flex items-center gap-2 text-accent-100">
          <Heart size={18} weight={dedicate ? "fill" : "regular"} className="text-accent-300" />
          Make a dedication
        </span>
        <span className="flex items-center gap-1 text-sm text-accent-300">
          {tokenMode ? (
            <>
              +{DEDICATION_COST} <Coin size={13} weight="fill" />
            </>
          ) : (
            "free"
          )}
        </span>
      </button>

      {dedicate && !contest && (
        <div className="mb-3 flex flex-col gap-2">
          <div className="relative">
            <input
              value={text}
              onChange={(e) => {
                setText(Array.from(e.target.value).slice(0, DEDICATION_MAX_LENGTH).join(""));
                setServerError(null);
              }}
              placeholder="for Sam 🎂"
              maxLength={DEDICATION_MAX_LENGTH * 2}
              aria-label="Dedication"
              aria-invalid={!!error}
              className="w-full rounded-md bg-bg px-4 py-3 pr-14 text-accent-100 outline-none"
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums text-accent-300"
              aria-live="off"
            >
              {length}/{DEDICATION_MAX_LENGTH}
            </span>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <p className="text-xs uppercase tracking-wide text-accent-300">How it looks on the TV</p>
          <div className="rounded-md bg-bg p-3" aria-hidden="true">
            <p className="truncate text-base font-medium text-accent-100">{track.name}</p>
            <p className="truncate text-xs text-accent-300">{track.artistName}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-accent-100">
              <Heart size={14} weight="fill" className="shrink-0 text-accent-300" />
              <span className="break-words">{text.trim() || "for Sam 🎂"}</span>
            </p>
          </div>
        </div>
      )}

      {!guessWho && (
        <button
          disabled={contest}
          onClick={() => setAnonymous((a) => !a)}
          aria-pressed={anonymous && !contest}
          className="mb-3 flex w-full items-center justify-between gap-3 rounded-lg bg-bg px-4 py-3 text-left disabled:opacity-40"
          style={{ boxShadow: anonymous && !contest ? "0 0 0 2px rgb(var(--color-accent))" : "0 0 0 1px rgb(var(--color-accent-700))" }}
        >
          <span className="flex flex-col">
            <span className="flex items-center gap-2 text-accent-100">
              <Detective size={18} weight={anonymous && !contest ? "fill" : "regular"} className="text-accent-300" /> Queue anonymously
            </span>
            <span className="text-xs text-accent-300">
              {tokenMode ? `+${ANONYMOUS_COST} token, +1 back if nobody guesses.` : "Nobody sees it's yours until the room guesses."}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-sm text-accent-300">
            {tokenMode ? (
              <>
                +{ANONYMOUS_COST} <Coin size={13} weight="fill" />
              </>
            ) : (
              "free"
            )}
          </span>
        </button>
      )}

      <button
        onClick={onCallBan}
        disabled={banWaitMs > 0 || banRunning || spacingSongs > 0}
        className="mb-3 flex w-full items-center justify-between gap-3 rounded-lg bg-bg px-4 py-3 text-left disabled:opacity-50"
        style={{ boxShadow: "0 0 0 1px rgb(var(--color-accent-700))" }}
      >
        <span className="flex flex-col">
          <span className="flex items-center gap-2 text-accent-100">
            <Prohibit size={18} className="text-accent-300" /> Call a ban vote
          </span>
          <span className="text-xs text-accent-300">
            {banRunning
              ? "A ban vote is already running."
              : banWaitMs > 0
                ? banCooldownLabel(banWaitMs)
                : spacingSongs > 0
                  ? "A game just ran. Available after the next song."
                  : "Vote a song out for the night. Once every so often."}
          </span>
        </span>
        <span className="shrink-0 text-sm text-accent-300">free</span>
      </button>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-3 font-semibold text-bg disabled:opacity-40"
      >
        {busy ? "Adding…" : total > 0 ? (
          <>
            {contest ? "Enter for" : "Add for"} {total} <Coin size={15} weight="fill" />
          </>
        ) : contest ? (
          "Enter the contest"
        ) : (
          "Add"
        )}
      </button>
      {short && <p className="mt-2 text-center text-xs text-accent-300">Not enough tokens for this.</p>}
    </Sheet>
  );
}
