import { useState } from "react";
import { Lock } from "@phosphor-icons/react";
import { FIRE_REACTION, REACTION_PALETTE } from "@manyqueue/shared";
import { Emoji } from "./Emoji";
import { Sheet } from "./Sheet";
import { useRoomStore } from "../store/roomStore";

/** The Me-tab control for the four reaction buttons: fire is fixed in slot 1;
 * tap any of the other three to swap it for something from the palette. */
export function ReactionPicker() {
  const reactionSet = useRoomStore((s) => s.reactionSet);
  const setReactionSlot = useRoomStore((s) => s.setReactionSlot);
  const [slot, setSlot] = useState<number | null>(null);

  return (
    <div className="flex w-full max-w-xs flex-col gap-3 rounded-lg bg-section p-4">
      <div>
        <p className="text-sm font-semibold text-accent-100">Your reactions</p>
        <p className="text-xs text-accent-300">Fire stays first. Tap the others to change them.</p>
      </div>
      <div className="flex justify-between">
        {reactionSet.map((emoji, i) => {
          const fixed = i === 0;
          return (
            <button
              key={i}
              disabled={fixed}
              onClick={() => setSlot(i)}
              aria-label={fixed ? `${emoji} (always first)` : `Change reaction ${i + 1}, currently ${emoji}`}
              className="relative grid h-14 w-14 place-items-center rounded-full bg-bg disabled:opacity-100"
              style={{ boxShadow: fixed ? "none" : "0 0 0 1px rgb(var(--color-accent-700))" }}
            >
              <Emoji value={emoji} size={28} />
              {fixed && (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-section text-accent-300">
                  <Lock size={11} weight="fill" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {slot !== null && (
        <Sheet label="Choose a reaction" onClose={() => setSlot(null)}>
          <p className="mb-3 text-lg font-semibold text-accent-100">Choose a reaction</p>
          <div className="grid grid-cols-6 gap-1.5">
            {REACTION_PALETTE.filter((e) => e !== FIRE_REACTION).map((e) => {
              const mine = reactionSet[slot] === e;
              const usedElsewhere = !mine && reactionSet.includes(e);
              return (
                <button
                  key={e}
                  onClick={() => {
                    setReactionSlot(slot, e);
                    setSlot(null);
                  }}
                  aria-label={usedElsewhere ? `${e} (swaps with another slot)` : e}
                  className="grid h-11 place-items-center rounded-md"
                  style={{
                    background: mine ? "rgb(var(--color-accent) / 0.16)" : "rgb(var(--color-bg))",
                    boxShadow: mine ? "0 0 0 2px rgb(var(--color-accent))" : "none",
                    opacity: usedElsewhere ? 0.5 : 1,
                  }}
                >
                  <Emoji value={e} size={22} />
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}
