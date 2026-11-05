import { CaretRight } from "@phosphor-icons/react";
import type { VoteOpenedPayload } from "@manyqueue/shared";
import { formatCountdown } from "../lib/format";
import { Emoji } from "./Emoji";

const VOTE_EMOJI: Record<VoteOpenedPayload["type"], string> = {
  skip: "⏭️",
  contest: "🏆",
  ban: "🚫",
  guess: "🕵️",
};

/** Shown while a vote is open but an action sheet is in the way. Tapping it
 * swaps to the vote; the action sheet keeps everything typed into it. */
export function VotePill({
  vote,
  now,
  onClick,
}: {
  vote: VoteOpenedPayload;
  now: number;
  onClick: () => void;
}) {
  const left = Math.max(0, vote.deadlineAt - now);
  return (
    <button
      onClick={onClick}
      className="fixed left-1/2 top-14 z-[75] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg shadow-lg"
      style={{ transform: "translateX(-50%)" }}
      aria-label={`Vote open, ${Math.ceil(left / 1000)} seconds left. Tap to vote.`}
    >
      <Emoji value={VOTE_EMOJI[vote.type]} size={16} />
      Vote open · <span className="tabular-nums">{formatCountdown(left)}</span>
      <CaretRight size={14} weight="bold" />
    </button>
  );
}
