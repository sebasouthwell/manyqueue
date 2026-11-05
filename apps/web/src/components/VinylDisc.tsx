import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  artUrl: string | null;
  spinning: boolean;
  size?: number;
}

/** Album art as a record: black grooved disc, the cover as the centre label,
 * a spindle hole. It turns while `spinning` (33⅓ rpm is ~1.8s a turn; this is
 * a calmer 5s) and holds its angle when paused. The gloss stays put while the
 * disc turns beneath it. No spin under prefers-reduced-motion. */
export function VinylDisc({ artUrl, spinning, size = 112 }: Props) {
  const reduced = useReducedMotion();
  const label = Math.round(size * 0.44);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "repeating-radial-gradient(circle at center, #14141c 0px, #14141c 1.5px, #1d1d28 2.5px, #14141c 3.5px)",
          boxShadow: "0 0 0 1px rgb(var(--color-accent-700)), 0 6px 18px rgb(0 0 0 / 0.45)",
          animation: reduced ? undefined : "mq-spin 5s linear infinite",
          animationPlayState: spinning ? "running" : "paused",
          willChange: "transform",
        }}
      >
        <div
          className="absolute overflow-hidden rounded-full bg-accent-800"
          style={{
            width: label,
            height: label,
            left: (size - label) / 2,
            top: (size - label) / 2,
            boxShadow: "0 0 0 2px #0c0c12",
          }}
        >
          {artUrl && <img src={artUrl} alt="" className="h-full w-full object-cover" draggable={false} />}
        </div>
        <div
          className="absolute rounded-full"
          style={{ width: 8, height: 8, left: size / 2 - 4, top: size / 2 - 4, background: "rgb(var(--color-section))", boxShadow: "0 0 0 1px #0c0c12" }}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 20deg, transparent 0deg, rgb(255 255 255 / 0.12) 40deg, transparent 90deg, transparent 200deg, rgb(255 255 255 / 0.08) 240deg, transparent 290deg)",
        }}
      />
    </div>
  );
}
