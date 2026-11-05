import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { votePhase, type VoteOpenedPayload, type VoteClosedPayload } from "@manyqueue/shared";
import { useRoomStore } from "../../store/roomStore";
import { useServerNow } from "../../hooks/useServerNow";
import { VoteSheet } from "../VoteSheet";
import { VotePill } from "../VotePill";

/*
 * Phone layer priority (UI-GUIDE §3.3): dialog > vote sheet > action sheet >
 * toast > banner. Dialogs and action sheets register here; the manager owns
 * the vote sheet. Only one thing is "on top" at a time, an action sheet that
 * a vote covers stays mounted (so its typed text survives), and a vote that
 * arrives while an action sheet is open waits behind a pill.
 */

type LayerKind = "dialog" | "action";
interface Layer {
  id: string;
  kind: LayerKind;
}

interface SheetContext {
  register: (layer: Layer, close: (() => void) | undefined) => () => void;
  setClose: (id: string, close: (() => void) | undefined) => void;
  /** Id of the layer that owns focus, Escape and the backdrop right now. */
  topId: string | null;
  /** True for action sheets a vote is currently covering. */
  actionsHidden: boolean;
}

const Ctx = createContext<SheetContext | null>(null);
export const VOTE_LAYER_ID = "vote";

/** Registers a dialog or action sheet with the manager for as long as the
 * caller is mounted. Outside a manager it degrades to "always on top". */
export function useSheetLayer(kind: LayerKind, close?: () => void) {
  const ctx = useContext(Ctx);
  const id = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!ctx) return;
    return ctx.register({ id, kind }, () => closeRef.current?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.register, id, kind]);
  return {
    hidden: !!ctx && kind === "action" && ctx.actionsHidden,
    isTop: !ctx || ctx.topId === id,
  };
}

type Intent = "shown" | "dismissed";

interface Props {
  children: ReactNode;
  onPick: (voteId: string, optionId: string) => void;
}

export function SheetManagerProvider({ children, onPick }: Props) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const closers = useRef(new Map<string, (() => void) | undefined>());
  const [intent, setIntent] = useState<Record<string, Intent>>({});

  const votes = useRoomStore((s) => s.votes);
  const voteClosed = useRoomStore((s) => s.voteClosed);
  const myBallots = useRoomStore((s) => s.myBallots);
  const voteCounts = useRoomStore((s) => s.voteCounts);
  const voteMeta = useRoomStore((s) => s.voteMeta);

  const now = useServerNow(votes.length > 0);

  const register = useCallback((layer: Layer, close: (() => void) | undefined) => {
    closers.current.set(layer.id, close);
    setLayers((prev) => [...prev, layer]);
    return () => {
      closers.current.delete(layer.id);
      setLayers((prev) => prev.filter((l) => l.id !== layer.id));
    };
  }, []);
  const setClose = useCallback((id: string, close: (() => void) | undefined) => {
    closers.current.set(id, close);
  }, []);

  const active = useMemo(() => {
    const live = votes
      .map((vote) => ({ vote, phase: votePhase(vote, voteClosed[vote.id], now) }))
      .filter((v) => v.phase !== "closed")
      .sort((a, b) => a.vote.deadlineAt - b.vote.deadlineAt);
    return live[0] ?? null;
  }, [votes, voteClosed, now]);

  const dialogs = layers.filter((l) => l.kind === "dialog");
  const actions = layers.filter((l) => l.kind === "action");
  const hasDialog = dialogs.length > 0;
  const hasAction = actions.length > 0;

  const voteIntent = active ? intent[active.vote.id] : undefined;
  // A casual vote (the for-fun "who queued this?") only ever shows as the pill; tapping it opens the sheet.
  const casual = !!active?.vote.casual;
  const showVote =
    !!active && !hasDialog && (voteIntent === "shown" || (voteIntent !== "dismissed" && !hasAction && !casual));
  const showPill = !!active && active.phase === "open" && !showVote;

  const topId = hasDialog
    ? dialogs[dialogs.length - 1].id
    : showVote
      ? VOTE_LAYER_ID
      : (actions[actions.length - 1]?.id ?? null);

  const dismissVote = useCallback(() => {
    if (active) setIntent((prev) => ({ ...prev, [active.vote.id]: "dismissed" }));
  }, [active]);
  const openVoteFromPill = useCallback(() => {
    if (active) setIntent((prev) => ({ ...prev, [active.vote.id]: "shown" }));
  }, [active]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || !topId) return;
      e.preventDefault();
      if (topId === VOTE_LAYER_ID) dismissVote();
      else closers.current.get(topId)?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [topId, dismissVote]);

  const ctx = useMemo<SheetContext>(
    () => ({ register, setClose, topId, actionsHidden: showVote }),
    [register, setClose, topId, showVote],
  );

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {showPill && active && (
        <VotePill vote={active.vote} now={now} onClick={openVoteFromPill} />
      )}
      {showVote && active && (
        <VoteSheet
          vote={active.vote}
          closed={voteClosed[active.vote.id]}
          phase={active.phase === "closed" ? "result" : active.phase}
          now={now}
          myOptionId={myBallots[active.vote.id] ?? null}
          counts={voteCounts[active.vote.id]}
          meta={voteMeta[active.vote.id]}
          active={topId === VOTE_LAYER_ID}
          onPick={(optionId) => onPick(active.vote.id, optionId)}
          onClose={dismissVote}
        />
      )}
    </Ctx.Provider>
  );
}

export type { VoteOpenedPayload, VoteClosedPayload };
