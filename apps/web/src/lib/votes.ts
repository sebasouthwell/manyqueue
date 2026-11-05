import { useRoomStore } from "../store/roomStore";

/** Casts (or changes) my ballot: shown immediately, rolled back if the server
 * refuses it. The endpoint arrives with the vote engine. */
export async function castBallot(code: string, voteId: string, optionId: string): Promise<void> {
  const { myBallots, setMyBallot } = useRoomStore.getState();
  const previous = myBallots[voteId] ?? null;
  setMyBallot(voteId, optionId);
  try {
    const res = await fetch(`/rooms/${code}/votes/${voteId}/ballot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    });
    if (!res.ok) setMyBallot(voteId, previous);
  } catch {
    setMyBallot(voteId, previous);
  }
}
