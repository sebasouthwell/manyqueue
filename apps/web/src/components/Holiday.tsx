import { useEffect, useMemo, useRef, useState } from "react";
import { activeHoliday, coverDecorFor, type CoverDecor, type Holiday } from "@manyqueue/shared";
import { useRoomStore } from "../store/roomStore";
import { Emoji } from "./Emoji";

/** The holiday that's on right now for this room (Settings → Holiday mode), checked against today's date. */
export function useHoliday(): Holiday | null {
  const mode = useRoomStore((s) => s.settings?.holidayMode ?? "auto");
  return activeHoliday(mode, new Date());
}

const reducedMotion = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** A corner cobweb: radial threads and sagging rings. */
function Cobweb({ size, flip }: { size: number; flip?: boolean }) {
  const threads = [0, 15, 30, 45, 60, 75, 90];
  const rings = [0.25, 0.45, 0.65, 0.85];
  const pt = (r: number, deg: number) => [Math.cos((deg * Math.PI) / 180) * r * size, Math.sin((deg * Math.PI) / 180) * r * size];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: flip ? "scaleX(-1)" : undefined }} aria-hidden>
      <g stroke="rgba(255,255,255,0.35)" strokeWidth={Math.max(1, size / 220)} fill="none">
        {threads.map((deg) => {
          const [x, y] = pt(1, deg);
          return <line key={deg} x1={0} y1={0} x2={x} y2={y} />;
        })}
        {rings.map((r) => (
          <path
            key={r}
            d={threads
              .slice(1)
              .map((deg, i) => {
                const [x0, y0] = pt(r, threads[i]);
                const [x1, y1] = pt(r, deg);
                const [cx, cy] = pt(r * 0.82, (threads[i] + deg) / 2); // sags inwards between threads
                return `${i === 0 ? `M${x0},${y0}` : ""} Q${cx},${cy} ${x1},${y1}`;
              })
              .join(" ")}
          />
        ))}
      </g>
    </svg>
  );
}

function Snow({ count, maxSize }: { count: number; maxSize: number }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: 4 + Math.random() * (maxSize - 4),
        duration: 8 + Math.random() * 10,
        delay: -Math.random() * 18,
        drift: (Math.random() - 0.5) * 120,
        opacity: 0.4 + Math.random() * 0.5,
      })),
    [count, maxSize],
  );
  if (reducedMotion()) return null;
  return (
    <>
      {flakes.map((f) => (
        <span
          key={f.id}
          className="absolute top-0 rounded-full bg-white"
          style={
            {
              left: `${f.left}%`,
              width: f.size,
              height: f.size,
              opacity: f.opacity,
              filter: "blur(0.5px)",
              animation: `mq-snow ${f.duration}s linear ${f.delay}s infinite`,
              "--drift": `${f.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </>
  );
}

/**
 * Holiday decorations, behind everything and never in the way of a tap. `tv` is the big 1920x1080 stage;
 * `phone` is lighter (fewer, smaller things).
 */
export function HolidayDecor({ variant }: { variant: "tv" | "phone" }) {
  const holiday = useHoliday();
  if (!holiday) return null;
  const tv = variant === "tv";
  if (holiday === "halloween") {
    const web = tv ? 260 : 110;
    const pumpkin = tv ? 64 : 28;
    return (
      <div className={`pointer-events-none ${tv ? "absolute" : "fixed"} inset-0 z-0 overflow-hidden`} aria-hidden>
        <div className="absolute left-0 top-0">
          <Cobweb size={web} />
        </div>
        <div className="absolute right-0 top-0">
          <Cobweb size={web} flip />
        </div>
        <div className="absolute bottom-0 left-0 flex items-end" style={{ gap: tv ? 12 : 4, padding: tv ? 16 : 6, opacity: 0.85 }}>
          <Emoji value="🎃" size={pumpkin} />
          <Emoji value="🎃" size={pumpkin * 0.7} />
        </div>
        <div className="absolute bottom-0 right-0 flex items-end" style={{ gap: tv ? 12 : 4, padding: tv ? 16 : 6, opacity: 0.85 }}>
          <Emoji value="🎃" size={pumpkin * 0.75} />
          <Emoji value="🎃" size={pumpkin} />
        </div>
        {tv && !reducedMotion() && (
          <>
            {[0, 1, 2].map((i) => (
              <span key={i} className="absolute" style={{ top: 120 + i * 90, left: -80, animation: `mq-bat ${16 + i * 5}s linear ${i * 6}s infinite` }}>
                <Emoji value="🦇" size={40 - i * 8} />
              </span>
            ))}
          </>
        )}
      </div>
    );
  }
  return (
    <div className={`pointer-events-none ${tv ? "absolute" : "fixed"} inset-0 z-0 overflow-hidden`} aria-hidden>
      <Snow count={tv ? 90 : 25} maxSize={tv ? 12 : 6} />
    </div>
  );
}

/** How far a decoration may rise above its cover: on the TV's big cover, more would reach the header. */
const MAX_LIFT = 70;

/** What this song's cover wears right now (see coverDecorFor), or null. */
export function useCoverDecor(): (trackName: string | null | undefined, albumName?: string | null) => CoverDecor | null {
  const mode = useRoomStore((s) => s.settings?.holidayMode ?? "auto");
  const now = new Date();
  return (trackName, albumName) => coverDecorFor(mode, now, trackName, albumName);
}

/** The decoration itself, positioned on a cover `size` wide (the cover's box must be position: relative). */
export function CoverDecoration({ kind, size }: { kind: CoverDecor; size: number }) {
  if (kind === "santa") return <SantaHat size={size} />;
  if (kind === "witch") return <WitchHat size={size} />;
  if (kind === "horns") return <DevilHorns size={size} />;
  return <CupidBow size={size} />;
}

/** Wraps an album cover and adds the season's decoration for this song (`size` = the cover's width). */
export function HatCover({ trackName, albumName, size, children }: { trackName: string | null | undefined; albumName?: string | null; size: number; children: React.ReactNode }) {
  const decor = useCoverDecor()(trackName, albumName);
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      {decor && <CoverDecoration kind={decor} size={size} />}
    </span>
  );
}

/** A crooked witch's hat perched on the top-left corner. */
export function WitchHat({ size }: { size: number }) {
  const w = Math.min(size * 0.46, 220);
  return (
    <svg width={w} height={w} viewBox="0 0 100 100" className="pointer-events-none absolute" style={{ left: -w * 0.26, top: -Math.min(w * 0.5, MAX_LIFT + 20), transform: "rotate(-18deg)", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.5))" }} aria-hidden>
      {/* the cone, its tip bent over */}
      <path d="M30 76 C38 52, 44 30, 52 12 C58 4, 70 2, 78 10 C70 10, 64 14, 62 22 C64 40, 68 58, 74 76 Z" fill="#2b1838" />
      <path d="M52 12 C58 4, 70 2, 78 10 C70 10, 64 14, 62 22 C58 18, 55 15, 52 12 Z" fill="#3d2350" />
      {/* band and buckle */}
      <path d="M31 70 C46 73, 60 73, 73 70 L74.5 78 C60 81, 45 81, 29.5 78 Z" fill="#7c3aed" />
      <rect x="47" y="70" width="10" height="9" rx="1.5" fill="none" stroke="#facc15" strokeWidth="2.4" />
      {/* brim */}
      <ellipse cx="52" cy="80" rx="46" ry="9" fill="#2b1838" />
      <ellipse cx="52" cy="78.5" rx="40" ry="5" fill="#3d2350" />
    </svg>
  );
}

/** A pair of little devil horns, one on each top corner. */
export function DevilHorns({ size }: { size: number }) {
  const w = Math.min(size * 0.24, 120);
  const horn = (flip: boolean) => (
    <svg
      width={w}
      height={w}
      viewBox="0 0 100 100"
      className="pointer-events-none absolute"
      style={{ [flip ? "right" : "left"]: size * 0.08, top: -Math.min(w * 0.72, MAX_LIFT), transform: flip ? "scaleX(-1)" : undefined, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`mq-horn-${flip ? "r" : "l"}`} x1="0" y1="1" x2="0.6" y2="0">
          <stop offset="0" stopColor="#7f1d1d" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path d="M22 98 C18 66, 26 30, 62 6 C50 34, 52 60, 70 98 Z" fill={`url(#mq-horn-${flip ? "r" : "l"})`} />
      <path d="M40 90 C38 66, 44 44, 58 22" stroke="rgba(255,255,255,0.35)" strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
  return (
    <>
      {horn(false)}
      {horn(true)}
    </>
  );
}

/** Cupid's bow drawn back on the top-right corner, a heart-tipped arrow nocked. */
export function CupidBow({ size }: { size: number }) {
  const w = Math.min(size * 0.44, 210);
  return (
    <svg width={w} height={w} viewBox="0 0 100 100" className="pointer-events-none absolute" style={{ right: -w * 0.28, top: -Math.min(w * 0.34, MAX_LIFT), transform: "rotate(18deg)", filter: "drop-shadow(0 5px 8px rgba(0,0,0,0.45))" }} aria-hidden>
      {/* bow */}
      <path d="M70 8 C34 20, 34 80, 70 92" stroke="#b45309" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M70 8 C38 21, 38 79, 70 92" stroke="#f59e0b" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* string, drawn back */}
      <path d="M70 8 L84 50 L70 92" stroke="#fde68a" strokeWidth="1.8" fill="none" />
      {/* arrow */}
      <line x1="84" y1="50" x2="16" y2="50" stroke="#fef3c7" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M84 50 L92 43 M84 50 L92 57 M80 50 L88 43 M80 50 L88 57" stroke="#f472b6" strokeWidth="3" strokeLinecap="round" />
      {/* heart tip */}
      <path d="M16 50 C10 44, 2 46, 4 53 C6 58, 14 62, 16 66 C18 62, 26 58, 28 53 C30 46, 22 44, 16 50 Z" transform="rotate(-90 16 55) translate(0 -5)" fill="#e11d48" />
    </svg>
  );
}

/** A Santa hat hanging off the top-left corner of an album cover (`size` = the cover's width). */
export function SantaHat({ size }: { size: number }) {
  const w = Math.min(size * 0.42, 210);
  return (
    <svg
      width={w}
      height={w}
      viewBox="0 0 100 100"
      className="pointer-events-none absolute"
      style={{ left: -w * 0.28, top: -Math.min(w * 0.42, MAX_LIFT), transform: "rotate(-22deg)", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))" }}
      aria-hidden
    >
      {/* the floppy red cone, tip drooping over to the right */}
      <path d="M12 78 C20 40, 45 12, 70 14 C86 15, 94 30, 88 44 C82 34, 72 30, 62 36 C70 50, 78 64, 86 78 Z" fill="#d42a2a" />
      <path d="M62 36 C70 50, 78 64, 86 78 L80 78 C72 62, 64 50, 58 40 Z" fill="#a51d1d" />
      {/* bobble */}
      <circle cx="88" cy="46" r="9" fill="#fafafa" />
      {/* fur brim */}
      <rect x="4" y="72" width="88" height="18" rx="9" fill="#fafafa" />
    </svg>
  );
}

/** Quiet ice sounds on the TV (Spotify is paused, so they're the only thing in the room): a sharp crack,
 * and the shatter at the end. Never loud, and silently skipped where audio isn't allowed. */
function iceAudio() {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    /* no audio */
  }
  const noise = (seconds: number) => {
    const buf = ctx!.createBuffer(1, Math.ceil(ctx!.sampleRate * seconds), ctx!.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ctx!.createBufferSource();
    src.buffer = buf;
    return src;
  };
  const out = (gainValue: number) => {
    const g = ctx!.createGain();
    g.gain.value = gainValue;
    g.connect(ctx!.destination);
    return g;
  };
  return {
    crack(strength: number) {
      if (!ctx) return;
      const src = noise(0.12 + strength * 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400 + Math.random() * 1600;
      bp.Q.value = 0.8;
      src.connect(bp).connect(out(0.12 + strength * 0.08));
      src.start();
    },
    shatter() {
      if (!ctx) return;
      const src = noise(0.9);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      src.connect(hp).connect(out(0.22));
      src.start();
      // Tinkling bits of ice.
      for (let i = 0; i < 9; i++) {
        const o = ctx.createOscillator();
        const g = out(0);
        const t = ctx.currentTime + 0.05 + Math.random() * 0.6;
        o.frequency.value = 2800 + Math.random() * 3200;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.3);
      }
    },
    close() {
      ctx?.close().catch(() => {});
    },
  };
}

const W = 1920;
const H = 1080;

/** The ice's break lines: rays from the impact with a kink part-way out, and a ring joining the kinks.
 * The shards are the cells between them, so it breaks exactly where it cracked. */
function iceGeometry() {
  const ix = 1010 + (Math.random() - 0.5) * 160;
  const iy = 470 + (Math.random() - 0.5) * 120;
  const rays = 13;
  const edge: [number, number][] = [];
  const mid: [number, number][] = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // Out to the stage's edge (and a little past, so shards cover the corners).
    const t = Math.min(dx > 0 ? (W - ix) / dx : dx < 0 ? -ix / dx : Infinity, dy > 0 ? (H - iy) / dy : dy < 0 ? -iy / dy : Infinity) * 1.25;
    edge.push([ix + dx * t, iy + dy * t]);
    const m = 120 + Math.random() * 160;
    const kink = (Math.random() - 0.5) * 0.5;
    mid.push([ix + Math.cos(a + kink) * m, iy + Math.sin(a + kink) * m]);
  }
  const shards: { points: [number, number][]; cx: number; cy: number; fly: { dx: number; dy: number; rot: number; secs: number } }[] = [];
  for (let i = 0; i < rays; i++) {
    const j = (i + 1) % rays;
    const inner: [number, number][] = [[ix, iy], mid[i], mid[j]];
    const outer: [number, number][] = [mid[i], edge[i], edge[j], mid[j]];
    for (const points of [inner, outer]) {
      const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
      const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
      // Where it falls: away from the impact, then down off the screen.
      const fly = {
        dx: (cx - ix) * 0.5 + (Math.random() - 0.5) * 120,
        dy: (cy - iy) * 0.3 + 900 + Math.random() * 400,
        rot: (Math.random() - 0.5) * 70,
        secs: 0.75 + Math.random() * 0.35,
      };
      shards.push({ points, cx, cy, fly });
    }
  }
  return { ix, iy, mid, edge, shards };
}

const ICE_BG =
  "radial-gradient(ellipse at 28% 18%, rgba(255,255,255,0.75), transparent 55%)," +
  "radial-gradient(ellipse at 78% 82%, rgba(255,255,255,0.45), transparent 50%)," +
  "linear-gradient(135deg, #d8f0fb 0%, #9fcbe6 35%, #e6f6fd 60%, #8fc0e0 85%, #cbe8f7 100%)";

/**
 * SHE IS DEFROSTING (November, just as the night's first Mariah starts; the server holds Spotify paused
 * meanwhile). Frost creeps over the whole TV, the warning (or the song's dedication) appears frozen in
 * it, the ice cracks in three goes, then shatters and falls away as she starts from the top.
 */
export function DefrostIce({ durationMs, dedication, from, onDone }: { durationMs: number; dedication: string | null; from: string | null; onDone: () => void }) {
  const geo = useMemo(iceGeometry, []);
  const [stage, setStage] = useState(0); // 0 frost, 1-3 cracks, 4 shatter
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const k = durationMs / 10_000;
    const audio = iceAudio();
    const at = (ms: number, f: () => void) => window.setTimeout(f, ms * k);
    const timers = [
      at(3000, () => (setStage(1), audio.crack(0))),
      at(5200, () => (setStage(2), audio.crack(0.5))),
      at(7200, () => (setStage(3), audio.crack(1))),
      at(9000, () => (setStage(4), audio.shatter())),
      at(10_000, () => done.current()),
    ];
    return () => {
      timers.forEach(clearTimeout);
      audio.close();
    };
  }, [durationMs]);

  const { ix, iy, mid, edge, shards } = geo;
  const line = (pts: [number, number][]) => pts.map((p) => p.join(",")).join(" ");
  const rays = mid.length;
  // Stage 1: a few short cracks from the impact; 2: all of them and the ring; 3: out to the edges.
  const shown = (i: number, part: "inner" | "ring" | "outer") =>
    part === "inner" ? stage >= 2 || (stage >= 1 && i % 3 === 0) : part === "ring" ? stage >= 2 : stage >= 3;
  // Two identical keyframes, alternated, so each crack restarts the jolt without remounting the ice.
  const shake = stage >= 1 && stage <= 3 ? `mq-ice-jolt${stage % 2} 0.25s ease-out` : undefined;

  return (
    <div className="absolute inset-0 z-[60] overflow-hidden" aria-live="polite">
      <div className="absolute inset-0" style={{ animation: shake }}>
        {/* Shattering: the ice as shards (only now: whole, clipped pieces leave hairline seams). */}
        {stage >= 4 &&
          shards.map((sh, i) => {
            const { dx, dy, rot, secs } = sh.fly;
            return (
              <div
                key={i}
                className="absolute inset-0"
                style={
                  {
                    clipPath: `polygon(${sh.points.map(([x, y]) => `${x}px ${y}px`).join(",")})`,
                    background: ICE_BG,
                    transformOrigin: `${sh.cx}px ${sh.cy}px`,
                    animation: `mq-shard-fall ${secs}s cubic-bezier(0.55, 0, 0.9, 0.45) both`,
                    "--dx": `${dx}px`,
                    "--dy": `${dy}px`,
                    "--rot": `${rot}deg`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        {stage < 4 && (
          // One solid sheet, faded in as a whole, until the moment it breaks.
          <div className="absolute inset-0" style={{ background: ICE_BG, animation: "mq-frost-in 1.4s ease-out both" }}>
            {/* Frost texture and a frozen vignette, over the whole sheet. */}
            <svg className="pointer-events-none absolute inset-0" width={W} height={H} style={{ mixBlendMode: "soft-light" }} aria-hidden>
              <filter id="mq-frost-tex">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="4" seed="7" />
                <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.4 -0.35" />
              </filter>
              <rect width={W} height={H} filter="url(#mq-frost-tex)" />
            </svg>
            <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 220px 60px rgba(255,255,255,0.85)" }} />

            {/* The message, frozen into the ice. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center px-40 text-center" style={{ animation: "mq-frost-text 1.2s ease-out 0.9s both" }}>
              {dedication ? (
                <>
                  <p className="font-bold uppercase tracking-[0.4em] text-[#2f6f94]" style={{ fontSize: 34 }}>
                    A dedication
                  </p>
                  <p className="mt-6 font-black leading-tight text-white" style={{ fontSize: 104, textShadow: "0 2px 0 #7fb3d3, 0 0 40px rgba(47,111,148,0.55)" }}>
                    “{dedication}”
                  </p>
                  {from && (
                    <p className="mt-8 font-semibold text-[#2f6f94]" style={{ fontSize: 44 }}>
                      from {from}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-bold uppercase tracking-[0.5em] text-[#2f6f94]" style={{ fontSize: 40 }}>
                    ⚠ Warning ⚠
                  </p>
                  <p className="mt-6 font-black text-white" style={{ fontSize: 150, textShadow: "0 3px 0 #7fb3d3, 0 0 50px rgba(47,111,148,0.6)" }}>
                    She is defrosting
                  </p>
                  <p className="mt-6 font-semibold text-[#2f6f94]" style={{ fontSize: 40 }}>
                    It's not even December.
                  </p>
                </>
              )}
            </div>

            {/* The cracks. */}
            <svg className="pointer-events-none absolute inset-0" width={W} height={H} aria-hidden>
              <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                {Array.from({ length: rays }, (_, i) => {
                  const j = (i + 1) % rays;
                  return (
                    <g key={i}>
                      {shown(i, "inner") && <Crack points={line([[ix, iy], mid[i]])} width={5} />}
                      {shown(i, "ring") && <Crack points={line([mid[i], mid[j]])} width={3} />}
                      {shown(i, "outer") && <Crack points={line([mid[i], edge[i]])} width={4} />}
                    </g>
                  );
                })}
              </g>
              {stage >= 1 && <circle cx={ix} cy={iy} r={stage * 10} fill="rgba(255,255,255,0.9)" style={{ filter: "blur(3px)" }} />}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

/** One crack line, drawing itself outwards: a dark fissure with a bright edge. */
function Crack({ points, width }: { points: string; width: number }) {
  return (
    <>
      <polyline points={points} stroke="rgba(30,70,100,0.55)" strokeWidth={width + 2} pathLength={1} strokeDasharray={1} style={{ animation: "mq-crack-draw 0.35s ease-out both" }} />
      <polyline points={points} stroke="rgba(255,255,255,0.95)" strokeWidth={width * 0.45} pathLength={1} strokeDasharray={1} transform="translate(1.5,-1.5)" style={{ animation: "mq-crack-draw 0.35s ease-out both" }} />
    </>
  );
}
