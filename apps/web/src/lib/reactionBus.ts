import type { ReactionPayload } from "@manyqueue/shared";

type Listener = (reaction: ReactionPayload) => void;
const listeners = new Set<Listener>();

/** Reactions are a firehose: they go straight to the TV layer, never through
 * React state or the store, so a flood can't cause re-renders. */
export const reactionBus = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  emit(reaction: ReactionPayload): void {
    for (const l of listeners) l(reaction);
  },
};
