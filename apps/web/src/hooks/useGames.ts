import { useCallback, useEffect, useRef, useState } from "react";
import { SOCKET_EVENTS, type GamesHistory, type GamesResponse, type GamesState } from "@manyqueue/shared";
import { getSocket } from "../socket";

/** What's live, the contest pool, and how the night's games went. The state
 * is pushed to staff sockets as it changes; history reloads when a game ends. */
export function useGames(code: string) {
  const [state, setState] = useState<GamesState | null>(null);
  const [history, setHistory] = useState<GamesHistory | null>(null);
  const liveId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/rooms/${code}/games`);
      if (!res.ok) return;
      const data: GamesResponse = await res.json();
      setState(data.state);
      setHistory(data.history);
      liveId.current = data.state.live?.voteId ?? null;
    } catch {
      // the next push or refresh will fill it in
    }
  }, [code]);

  useEffect(() => {
    refresh();
    const socket = getSocket();
    function onState(next: GamesState) {
      const ended = liveId.current !== null && next.live === null;
      liveId.current = next.live?.voteId ?? null;
      setState(next);
      if (ended) refresh();
    }
    socket.on(SOCKET_EVENTS.GAMES_STATE, onState);
    return () => {
      socket.off(SOCKET_EVENTS.GAMES_STATE, onState);
    };
  }, [code, refresh]);

  return { state, history, refresh };
}
