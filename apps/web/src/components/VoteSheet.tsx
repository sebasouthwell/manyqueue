import { Check, Detective } from "@phosphor-icons/react";
import { Emoji } from "./Emoji";
import { banBarLayout, type VoteClosedPayload, type VoteOpenedPayload, type VotePhase } from "@manyqueue/shared";
import { formatCountdown } from "../lib/format";
import { SheetFrame } from "./sheets/SheetFrame";

interface Props {
  vote: VoteOpenedPayload;
  closed: VoteClosedPayload | undefined;
  phase: Exclude<VotePhase, "closed">;
  now: number;
  myOptionId: string | null;
  counts: Record<string, number> | undefined;
  /** Ban votes: live yes-votes-needed and electorate size. */
  meta?: { threshold?: number; active?: number };
  active: boolean;
  onPick: (optionId: string) => void;
  onClose: () => void;
}

/** The phone side of every vote type: pick a card, watch the live bar, and
 * see the result for 2s once the deadline passes. What differs per game
 * (title, cards, who can't be picked) all arrives in the vote payload. */
export function VoteSheet({ vote, closed, phase, now, myOptionId, counts, meta, active, onPick, onClose }: Props) {
  const total = vote.options.reduce((sum, o) => sum + (counts?.[o.id] ?? 0), 0);
  const resultShown = phase === "result";
  const winnerId = closed?.winnerOptionId ?? null;
  const left = Math.max(0, vote.deadlineAt - now);

  if (vote.type === "guess") {
    const locked = myOptionId !== null;
    const isAdder = vote.options.length > 0 && vote.options.every((o) => o.disabledReason);
    return (
      <SheetFrame label={vote.title} zIndex={70} active={active} onClose={onClose}>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="flex items-center gap-2 text-lg font-semibold text-accent-100">
            <Detective size={20} weight="fill" className="text-accent-300" /> {vote.title}
          </p>
          <p className="tabular-nums text-2xl font-bold text-accent-100">{formatCountdown(left)}</p>
        </div>
        <p className="mb-3 text-sm text-accent-300" role={resultShown ? "status" : undefined}>
          {resultShown
            ? (closed?.summary ?? "Time's up.")
            : isAdder
              ? "It's your pick. Sit tight while the room guesses."
              : locked
                ? "Locked in. We'll reveal it soon."
                : (vote.instruction ?? "Your first pick is final")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {vote.options.map((option) => {
            const mine = myOptionId === option.id;
            return (
              <button
                key={option.id}
                onClick={() => onPick(option.id)}
                disabled={resultShown || locked || !!option.disabledReason}
                aria-pressed={mine}
                className="flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-2xl bg-bg px-3 text-center disabled:opacity-100"
                style={{
                  boxShadow: mine ? "0 0 0 2px rgb(var(--color-accent))" : "0 0 0 1px rgb(var(--color-accent-700))",
                  opacity: (locked && !mine) || isAdder ? 0.5 : 1,
                  transition: "opacity 200ms ease, box-shadow 150ms ease",
                }}
              >
                {option.emoji ? <Emoji value={option.emoji} size={44} /> : null}
                <span className="max-w-full truncate font-semibold text-accent-100">{option.label}</span>
                <span className="flex h-4 items-center gap-1 text-[11px] font-medium text-accent-200">
                  {mine && (
                    <>
                      <Check size={12} weight="bold" /> Your guess
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </SheetFrame>
    );
  }

  if (vote.type === "ban") {
    const yes = counts?.yes ?? 0;
    const no = counts?.no ?? 0;
    const threshold = meta?.threshold ?? vote.threshold ?? 4;
    const layout = banBarLayout(yes, no, meta?.active ?? vote.active ?? 0, threshold);
    return (
      <SheetFrame label={vote.title} zIndex={70} active={active} onClose={onClose}>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="text-lg font-semibold text-accent-100">{vote.title}</p>
          <p className="tabular-nums text-2xl font-bold text-accent-100">{formatCountdown(left)}</p>
        </div>

        {vote.target && (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-bg p-2.5">
            {vote.target.albumArtUrl ? (
              <img src={vote.target.albumArtUrl} alt="" className="h-14 w-14 rounded" />
            ) : (
              <div className="h-14 w-14 rounded bg-accent-800" />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold text-accent-100">{vote.target.name}</p>
              <p className="truncate text-sm text-accent-300">{vote.target.artist}</p>
            </div>
          </div>
        )}

        {resultShown ? (
          <p className="mb-3 text-sm text-accent-200" role="status">
            {closed?.summary ?? "The vote is over."}
          </p>
        ) : (
          <p className="mb-3 text-sm text-accent-300">Ban it and it won't play again tonight.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          {vote.options.map((option) => {
            const mine = myOptionId === option.id;
            const isBan = option.id === "yes";
            return (
              <button
                key={option.id}
                onClick={() => onPick(option.id)}
                disabled={resultShown}
                aria-pressed={mine}
                className="flex min-h-[92px] flex-col items-center justify-center gap-1 rounded-2xl bg-bg px-3 text-center disabled:opacity-100"
                style={{
                  boxShadow: mine ? "0 0 0 2px rgb(var(--color-accent))" : "0 0 0 1px rgb(var(--color-accent-700))",
                  opacity: resultShown && !mine ? 0.6 : 1,
                }}
              >
                <span className="text-2xl">{isBan ? "🚫" : "🙌"}</span>
                <span className="text-lg font-semibold text-accent-100">{option.label}</span>
                <span className="flex h-4 items-center gap-1 text-[11px] font-medium text-accent-200">
                  {mine && (
                    <>
                      <Check size={12} weight="bold" /> Your vote
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <div className="relative">
            <div className="flex h-3 overflow-hidden rounded-full bg-accent-800">
              <div style={{ width: `${layout.yesPct}%`, background: "rgb(var(--color-danger))", transition: "width 300ms ease" }} />
              <div className="flex-1" />
              <div style={{ width: `${layout.noPct}%`, background: "rgb(var(--color-accent-300))", transition: "width 300ms ease" }} />
            </div>
            <div
              className="absolute bg-accent-100"
              style={{ left: `${layout.thresholdPct}%`, top: -4, width: 3, height: 20, borderRadius: 2, transform: "translateX(-1.5px)" }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs tabular-nums text-accent-300">
            <span>Ban · {yes}</span>
            <span className="text-accent-100">Needs {threshold} to ban</span>
            <span>Keep · {no}</span>
          </div>
        </div>
      </SheetFrame>
    );
  }

  return (
    <SheetFrame label={vote.title} zIndex={70} active={active} onClose={onClose}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-lg font-semibold text-accent-100">{vote.title}</p>
        <p className="tabular-nums text-2xl font-bold text-accent-100" aria-live="off">
          {formatCountdown(left)}
        </p>
      </div>

      {resultShown ? (
        <p className="mb-3 text-sm text-accent-200" role="status">
          {closed?.summary ?? (winnerId ? "We have a winner." : "No winner this time.")}
        </p>
      ) : (
        vote.instruction && <p className="mb-3 text-sm text-accent-300">{vote.instruction}</p>
      )}

      <div className={`grid gap-3 ${vote.options.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {vote.options.map((option) => {
          const mine = myOptionId === option.id;
          const disabled = !!option.disabledReason || resultShown;
          const faded = resultShown && winnerId !== null && winnerId !== option.id;
          const pct = total > 0 ? Math.round(((counts?.[option.id] ?? 0) / total) * 100) : 0;
          return (
            <button
              key={option.id}
              onClick={() => onPick(option.id)}
              disabled={disabled}
              aria-pressed={mine}
              className="flex flex-col items-stretch gap-2 rounded-lg bg-bg p-2.5 text-left disabled:opacity-100"
              style={{
                boxShadow: mine ? "0 0 0 2px rgb(var(--color-accent))" : "none",
                opacity: option.disabledReason ? 0.5 : faded ? 0.4 : 1,
                transform: resultShown && winnerId === option.id ? "scale(1.03)" : undefined,
                transition: "opacity 300ms ease, transform 300ms ease, box-shadow 150ms ease",
              }}
            >
              {option.albumArtUrl ? (
                <img src={option.albumArtUrl} alt="" className="aspect-square w-full rounded-md object-cover" />
              ) : (
                <div className="aspect-square w-full rounded-md bg-accent-800" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-accent-100">{option.label}</p>
                {option.sublabel && <p className="truncate text-xs text-accent-300">{option.sublabel}</p>}
              </div>
              <p className="flex h-4 items-center gap-1 text-[11px] font-medium text-accent-200">
                {option.disabledReason ? (
                  option.disabledReason
                ) : mine ? (
                  <>
                    <Check size={12} weight="bold" /> Your vote
                  </>
                ) : null}
              </p>
            </button>
          );
        })}
      </div>

      {total > 0 && (
        <div className="mt-3" aria-hidden="true">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-accent-800">
            {vote.options.map((o, i) => (
              <div
                key={o.id}
                style={{
                  width: `${((counts?.[o.id] ?? 0) / total) * 100}%`,
                  background: i % 2 === 0 ? "rgb(var(--color-accent-300))" : "rgb(var(--color-accent))",
                  transition: "width 300ms ease",
                }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs tabular-nums text-accent-300">
            {vote.options.map((o) => (
              <span key={o.id}>{Math.round(((counts?.[o.id] ?? 0) / total) * 100)}%</span>
            ))}
          </div>
        </div>
      )}
    </SheetFrame>
  );
}
