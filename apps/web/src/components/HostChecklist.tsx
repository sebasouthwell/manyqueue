import { useState, type ReactNode } from "react";
import { CheckCircle, Circle } from "@phosphor-icons/react";

interface HostChecklistProps {
  code: string;
  deviceName: string | null;
}

const MANUAL = [
  { id: "sleep", label: "Laptop sleep/screen-lock turned off" },
  { id: "tv", label: "TV window dragged to the TV and fullscreen (F11)" },
] as const;

function load(code: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(`mq-checklist-${code}`) ?? "{}");
  } catch {
    return {};
  }
}

/** Setup steps, at the top of the page until every one is done, then gone. The speaker ticks itself; the two
 * laptop steps are ticked by hand (and remembered for this room). */
export function HostChecklist({ code, deviceName }: HostChecklistProps) {
  const [done, setDone] = useState<Record<string, boolean>>(() => load(code));
  const speakerReady = !!deviceName;

  const allDone = speakerReady && MANUAL.every((m) => done[m.id]);
  if (allDone) return null;

  function toggle(id: string) {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(`mq-checklist-${code}`, JSON.stringify(next));
      } catch {
        // storage blocked: the ticks just won't be remembered
      }
      return next;
    });
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-panel p-4 text-left shadow-[0_0_0_1px_rgb(var(--color-accent-700))]">
      <p className="text-xs uppercase tracking-wide text-accent-300">Before you start</p>
      <Row done={speakerReady}>{speakerReady ? `Speaker picked: ${deviceName}` : "Pick a speaker (on the right)"}</Row>
      {MANUAL.map((m) => (
        <Row key={m.id} done={!!done[m.id]} onClick={() => toggle(m.id)}>
          {m.label}
        </Row>
      ))}
    </div>
  );
}

function Row({ done, onClick, children }: { done: boolean; onClick?: () => void; children: ReactNode }) {
  const Icon = done ? CheckCircle : Circle;
  const inner = (
    <>
      <Icon size={18} weight={done ? "fill" : "regular"} className={done ? "text-success" : "text-accent-300"} />
      <span className={done ? "text-accent-100" : "text-accent-200"}>{children}</span>
    </>
  );
  return onClick ? (
    <button onClick={onClick} className="flex items-center gap-2 text-left text-sm" role="checkbox" aria-checked={done}>
      {inner}
    </button>
  ) : (
    <div className="flex items-center gap-2 text-sm">{inner}</div>
  );
}
