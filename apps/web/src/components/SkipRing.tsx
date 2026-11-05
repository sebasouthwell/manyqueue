import { useEffect, useRef, useState } from "react";
import type { VoteTallyPayload } from "@manyqueue/shared";

const SIZE = 112;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SkipRing({ tally }: { tally: VoteTallyPayload | null }) {
  const [pulse, setPulse] = useState(false);
  const lastCount = useRef(tally?.count ?? 0);

  useEffect(() => {
    if (tally && tally.count !== lastCount.current) {
      lastCount.current = tally.count;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 300);
      return () => clearTimeout(t);
    }
  }, [tally]);

  const count = tally?.count ?? 0;
  const threshold = tally?.threshold ?? 3;
  const fraction = threshold > 0 ? Math.min(1, count / threshold) : 0;

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        transform: pulse ? "scale(1.08)" : "scale(1)",
        transition: "transform 150ms ease",
      }}
    >
      <svg width={SIZE} height={SIZE}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="rgb(var(--color-section))"
          stroke="rgb(var(--color-accent-900))"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="rgb(var(--color-accent-300))"
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: "stroke-dashoffset 300ms ease" }}
        />
      </svg>
      <div
        style={{ marginTop: -SIZE, height: SIZE }}
        className="flex flex-col items-center justify-center"
      >
        <p className="font-medium text-accent-100" style={{ fontSize: 26 }}>
          {count}/{threshold}
        </p>
        <p className="text-accent-200" style={{ fontSize: 16 }}>
          💀 skip
        </p>
      </div>
    </div>
  );
}
