import { useEffect, useState } from "react";
import { Emoji } from "./Emoji";
import { formatCountdown } from "../lib/format";

/** While the room is guessing, a line in the now-playing card: who queued it, and how long is left. */
export function GuessLine({ deadlineAt, serverNow }: { deadlineAt: number | null; serverNow: () => number }) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(t);
  }, [serverNow]);
  return (
    <p className="flex items-center gap-3 text-accent-100" style={{ fontSize: 30, fontWeight: 500, paddingTop: 6 }}>
      <Emoji value="🕵️" size={34} />
      Who queued it? Guess on your phone
      {deadlineAt !== null && <span className="tabular-nums text-accent-300">{formatCountdown(deadlineAt - now)}</span>}
    </p>
  );
}
