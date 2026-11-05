import { useEffect, useState } from "react";
import { sceneById, type SceneId } from "@manyqueue/shared";
import { useReducedMotion } from "../hooks/useReducedMotion";

/** Seconds for one drift of the light blobs: livelier scenes move faster. */
const DRIFT_SECONDS: Record<SceneId, number> = { neon: 16, pop: 22, rock: 26, hiphop: 28, latin: 30, country: 34, classic: 36, chill: 42 };

function Layer({ id, visible, reduced }: { id: SceneId; visible: boolean; reduced: boolean }) {
  const scene = sceneById(id);
  const [a, b, c] = scene.colors;
  const t = DRIFT_SECONDS[id];
  const blob = (color: string, size: number, left: string, top: string, name: string, delay: number) => (
    <div
      key={name}
      className="absolute rounded-full"
      style={{
        width: size,
        height: size,
        left,
        top,
        background: `radial-gradient(closest-side, rgb(${color} / 0.55), transparent 70%)`,
        willChange: "transform",
        animation: reduced ? undefined : `${name} ${t}s ease-in-out ${delay}s infinite alternate`,
      }}
    />
  );
  return (
    <div
      className="absolute inset-0"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 1800ms ease", background: `radial-gradient(ellipse at 50% 100%, rgb(${c} / 0.16), transparent 60%)` }}
    >
      {blob(a, 1100, "-8%", "-25%", "mq-scene-a", 0)}
      {blob(b, 1000, "58%", "-15%", "mq-scene-b", -t / 3)}
      {blob(c, 1200, "22%", "48%", "mq-scene-c", -t / 1.5)}
    </div>
  );
}

/**
 * The TV's genre scene: slow-drifting coloured light behind everything, crossfading when the song's genre
 * changes. CSS only (transform and opacity), so it costs the TV almost nothing; with reduced motion the
 * light just sits there. Renders nothing for the plain background.
 */
export function SceneBackground({ scene }: { scene: SceneId | null }) {
  const reduced = useReducedMotion();
  // Keep the scene that just left on screen while it fades out.
  const [shown, setShown] = useState<SceneId[]>(scene ? [scene] : []);
  useEffect(() => {
    setShown((prev) => (scene && !prev.includes(scene) ? [...prev.slice(-1), scene] : prev));
    const t = setTimeout(() => setShown((prev) => (scene ? prev.filter((s) => s === scene) : prev)), 2000);
    return () => clearTimeout(t);
  }, [scene]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }} aria-hidden="true">
      <style>{`
        @keyframes mq-scene-a { from { transform: translate(0, 0) scale(1) } to { transform: translate(260px, 160px) scale(1.15) } }
        @keyframes mq-scene-b { from { transform: translate(0, 0) scale(1.1) } to { transform: translate(-300px, 190px) scale(0.95) } }
        @keyframes mq-scene-c { from { transform: translate(0, 0) scale(0.95) } to { transform: translate(220px, -170px) scale(1.12) } }
      `}</style>
      {shown.map((id) => (
        <Layer key={id} id={id} visible={id === scene} reduced={reduced} />
      ))}
    </div>
  );
}
