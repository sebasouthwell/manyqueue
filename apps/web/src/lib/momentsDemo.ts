import type { Moment, ToastPayload, TakeoverPayload } from "@manyqueue/shared";

interface DemoEngine {
  pushMoment: (m: Moment) => void;
  endMoment: (id: string) => void;
  pushToast: (t: ToastPayload) => void;
  serverNow: () => number;
}

let run = 0;

/** /tv?demo=moments — a contest, a reveal, a dedication and 8 toasts all at
 * once, to see the priority order and that nothing overlaps. A real server
 * would send moment:end itself; the demo plays that part with timers. */
export function runMomentsDemo(engine: DemoEngine): void {
  run += 1;
  const now = engine.serverNow();
  const id = (name: string) => `demo-${run}-${name}`;

  const contest: TakeoverPayload = {
    question: "Which plays next?",
    deadlineAt: now + 10_000,
    instruction: "Vote on your phone",
    choices: [
      { id: "a", label: "Levitating", sublabel: "Dua Lipa", artUrl: null, percent: 60 },
      { id: "b", label: "Blinding Lights", sublabel: "The Weeknd", artUrl: null, percent: 40 },
    ],
  };
  const reveal: TakeoverPayload = {
    question: "It was Maya",
    reveal: {
      name: "Maya",
      emoji: "🦋",
      trackName: "Levitating",
      artistName: "Dua Lipa",
      nobodyGuessed: false,
      guesses: [
        { id: "maya", name: "Maya", emoji: "🦋", percent: 50 },
        { id: "sam", name: "Sam", emoji: "🐸", percent: 25 },
        { id: "ali", name: "Ali", emoji: "🦊", percent: 25 },
        { id: "bo", name: "Bo", emoji: "🐙", percent: 0 },
      ],
    },
  };
  const dedication: TakeoverPayload = { question: "For Sam 🎂", instruction: "Happy birthday", splash: true };

  // Fired in the "wrong" order on purpose — priority, not arrival, decides.
  engine.pushMoment({ id: id("dedication"), kind: "dedication", priority: 3, payload: dedication, minMs: 3000 });
  engine.pushMoment({ id: id("reveal"), kind: "reveal", priority: 2, payload: reveal, minMs: 4000 });
  engine.pushMoment({ id: id("contest"), kind: "contest", priority: 1, payload: contest, minMs: 5000, until: now + 10_000 });
  setTimeout(() => engine.endMoment(id("reveal")), 16_000);
  setTimeout(() => engine.endMoment(id("dedication")), 22_000);

  const joins: [string, string][] = [["🦋", "Maya"], ["🐸", "Sam"], ["🦊", "Ali"], ["🐙", "Bo"]];
  joins.forEach(([emoji, nickname], i) =>
    engine.pushToast({ id: id(`join${i}`), message: `${emoji} ${nickname} joined`, join: { emoji, nickname } }),
  );
  ["🎉 Maya earned a token — Won the dance-off", "⏭️ Skipped", "⭐ Jake is now a co-host", "🪙 +1 for everyone"].forEach(
    (message, i) => engine.pushToast({ id: id(`t${i}`), message }),
  );
}
