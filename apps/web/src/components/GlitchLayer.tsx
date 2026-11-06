import { useEffect, useState } from "react";
import { useRoomStore } from "../store/roomStore";

/**
 * Easter egg: the host's glitch dial (0-100) for this guest. Meant to look like the app (or the phone)
 * is genuinely failing, and to drive them slowly mad:
 * - **Real failures, not effects.** Nothing eases or glows. Everything is a hard cut lasting a frame or
 *   a few: screen tearing (bands of the page shifted sideways), GPU junk blocks, a word turning into
 *   encoding garbage, a line falling back to Times or Courier, an element jumping a few pixels with no
 *   motion, the page stuttering, an album cover failing to load, a colour channel dropping out, and the
 *   app's own "Reconnecting…" pill appearing while it's actually fine, and fault notices that get worse.
 * - **It creeps up.** Whatever the dial says, it starts faint and grows to full strength over about
 *   15 minutes (the clock restarts when the host changes the dial). Timed glitches and 100 skip that.
 * - **Long calm spells** between short episodes, and the odd stray blink in between.
 * Everything puts itself back, so the app stays usable. Reduced motion keeps only the still effects.
 */

const ZALGO_UP = "̍̎̄̅̿̑̆̐͒͗͑̇̈̊͂̓̈́͊͋͌̃̂̌͐̀́̋̏̒̓̔̽̉ͣͤͥͦͧͨͩͪͫͬͭͮͯ̾͛͆̚";
const ZALGO_MID = "̴̵̶̷̸̡̢̧̨̛̖̗̘̙̜̝̞̟̠̣̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼͇͈͉͍͎̀́͂̓̈́͆͊͋͌̕̚ͅ͏͓͔͕͖͙͚͐͑͒͗͛ͣͤͥͦͧͨͩͪͫͬͭͮͯ͘͜͟͢͝͞͠͡";
const ZALGO_DOWN = "̖̗̘̙̜̝̞̟̠̤̥̦̩̪̫̬̭̮̯̰̱̲̳̹̺̻̼͇͈͉͍͎͓͔͕͖͙͚̣ͅ";
const pick = (s: string) => s[Math.floor(Math.random() * s.length)];

export function zalgo(text: string, intensity: number): string {
  const n = Math.max(1, Math.round(intensity * 6));
  return Array.from(text)
    .map((ch) => {
      if (ch === " " || Math.random() > 0.4 + intensity * 0.6) return ch;
      let out = ch;
      for (let i = 0; i < n; i++) out += pick(ZALGO_UP) + (Math.random() < 0.5 ? pick(ZALGO_MID) : "") + pick(ZALGO_DOWN);
      return out;
    })
    .join("");
}

function scramble(text: string): string {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length - 1; i++) {
    if (chars[i] !== " " && Math.random() < 0.35) [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
  }
  return chars.map((c) => (c !== " " && Math.random() < 0.08 ? pick("█▓▒░#@%&$") : c)).join("");
}

/** Visible text nodes under the app, skipping inputs and anything the user is typing in. */
function textNodes(): Text[] {
  const root = document.body;
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || !n.nodeValue || n.nodeValue.trim().length < 2) return NodeFilter.FILTER_REJECT;
      if (p.closest("input, textarea, [contenteditable], script, style, [data-no-glitch]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) out.push(walker.currentNode as Text);
  return out;
}

/** Swaps a text node's text for a moment, then puts it back unless React changed it meanwhile. */
function corrupt(node: Text, make: (t: string) => string, ms: number) {
  const original = node.nodeValue ?? "";
  const glitched = make(original);
  node.nodeValue = glitched;
  setTimeout(() => {
    if (node.nodeValue === glitched) node.nodeValue = original;
  }, ms);
}

function randomElements(selector: string, count: number): HTMLElement[] {
  const all = Array.from(document.body.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.closest("[data-no-glitch]"));
  const out: HTMLElement[] = [];
  for (let i = 0; i < count && all.length; i++) out.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
  return out;
}

/** Turns one of the root filters on for `ms` (see index.css: html.mq-glitched). */
function flashFilter(part: "tear" | "chan" | "inv", value: string, ms: number) {
  const html = document.documentElement;
  html.style.setProperty(`--mq-f-${part}`, value);
  setTimeout(() => html.style.removeProperty(`--mq-f-${part}`), ms);
}

/** The unravelling: notices in the app's own toast style, believable faults that get worse. */
const THREATS: [number, string][] = [
  [0.3, "Display driver stopped responding and has recovered"],
  [0.4, "Rendering error 0x0000007E"],
  [0.5, "Graphics memory low"],
  [0.6, "Clock drift detected: 3,812 ms"],
  [0.7, "Sync conflict: queue restored from an older copy"],
  [0.8, "Signal integrity: 41%"],
  [0.9, "Unrecoverable display error. Restart recommended"],
];

function flashClass(el: Element, cls: string, ms: number) {
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/** UTF-8 read as Windows-1252: what a real encoding bug looks like. */
function mojibake(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const cp1252: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x99: "™", 0x9c: "œ" };
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : (cp1252[b] ?? String.fromCharCode(b));
  // ASCII text has nothing to mangle: swap a few letters for replacement characters instead.
  return out === text ? Array.from(text).map((c) => (c !== " " && Math.random() < 0.3 ? (Math.random() < 0.5 ? "�" : "Ã©") : c)).join("") : out;
}

/** Sets inline styles for `ms`, then puts the old ones back. */
function briefly(el: HTMLElement, styles: Partial<CSSStyleDeclaration>, ms: number) {
  const prev: Record<string, string> = {};
  for (const k of Object.keys(styles)) prev[k] = (el.style as unknown as Record<string, string>)[k];
  Object.assign(el.style, styles);
  setTimeout(() => Object.assign(el.style, prev), ms);
}

/** One-frame junk blocks, like a GPU dropping tiles. */
function junkBlocks(count: number) {
  const colours = ["#ff00ff", "#00ff00", "#000000", "#00ffff", "#ffffff"];
  const blocks: HTMLDivElement[] = [];
  for (let i = 0; i < count; i++) {
    const b = document.createElement("div");
    const w = 8 + Math.random() * 120;
    const h = 4 + Math.random() * 40;
    Object.assign(b.style, {
      position: "fixed",
      left: `${Math.random() * (window.innerWidth - w)}px`,
      top: `${Math.random() * (window.innerHeight - h)}px`,
      width: `${w}px`,
      height: `${h}px`,
      background: colours[Math.floor(Math.random() * colours.length)],
      zIndex: "99",
      pointerEvents: "none",
      mixBlendMode: Math.random() < 0.5 ? "normal" : "difference",
    });
    document.body.appendChild(b);
    blocks.push(b);
  }
  setTimeout(() => blocks.forEach((b) => b.remove()), 34 + Math.random() * 60);
}

const CREEPY_WORDS = ["behind you", "again", "listen", "wake up", "not yet", "who?", "stay", "it's here", "don't", "help", "wrong"];

/** Jumps an element a few pixels with no motion, then back: it rendered in the wrong place. */
function jump(el: HTMLElement, dx: number, dy: number, holdMs: number) {
  briefly(el, { transform: `${el.style.transform} translate(${Math.round(dx)}px, ${Math.round(dy)}px)`, transition: "none" }, holdMs);
}

/** One word in a text node reads as something else for a moment. */
function swapWord(node: Text, ms: number) {
  corrupt(
    node,
    (t) => {
      const words = t.split(/(\s+)/);
      const idx = words.map((w, i) => (/\w{3,}/.test(w) ? i : -1)).filter((i) => i >= 0);
      if (idx.length === 0) return t;
      words[idx[Math.floor(Math.random() * idx.length)]] = CREEPY_WORDS[Math.floor(Math.random() * CREEPY_WORDS.length)];
      return words.join("");
    },
    ms,
  );
}

const TEXTY = "p, span, h1, h2, h3, button, li";

export function GlitchLayer() {
  const live = useRoomStore((s) => s.glitchLive);
  const level = live?.level ?? 0;
  const instant = live?.instant ?? false;
  const [rgb, setRgb] = useState(0);
  // A new noise pattern for each tear, so it never tears the same way twice.
  const [seed, setSeed] = useState(1);
  useEffect(() => {
    if (level <= 0) return;
    const t = setInterval(() => setSeed((n) => (n % 997) + 1), 700);
    return () => clearInterval(t);
  }, [level]);

  useEffect(() => {
    const html = document.documentElement;
    if (level <= 0) {
      html.classList.remove("mq-glitched");
      html.style.removeProperty("--mq-glitch");
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dial = level / 100;
    const startedAt = Date.now();
    // 15% of the dial at first, the full dial after ~15 minutes. 100 is all-out right away.
    const allOut = instant;
    const strength = () => (allOut ? 1 : dial * Math.min(1, 0.15 + (Date.now() - startedAt) / (15 * 60_000)));
    html.classList.add("mq-glitched");

    let stopped = false;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(() => !stopped && fn(), ms));
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const oneOf = <T,>(xs: T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)];

    const setFakeOffline = useRoomStore.getState().setFakeOffline;
    let threatIndex = 0;
    // Small, deniable things: any strength.
    const subtle: (() => void)[] = [
      () => {
        const el = oneOf(randomElements(TEXTY, 1));
        if (el) jump(el, rand(-5, 5), rand(-3, 3), rand(300, 2500));
      },
      () => {
        const node = oneOf(textNodes());
        if (node) swapWord(node, rand(120, 260));
      },
      () => {
        const node = oneOf(textNodes());
        if (node) corrupt(node, mojibake, rand(90, 400));
      },
      () => {
        const el = oneOf(randomElements("p, span, h1, h2, h3, button", 1));
        if (el) briefly(el, { fontFamily: Math.random() < 0.5 ? '"Times New Roman", Times, serif' : '"Courier New", Courier, monospace' }, rand(150, 900));
      },
      () => {
        const el = oneOf(randomElements(TEXTY + ", img", 1));
        if (el) flashClass(el, "mq-blink", rand(34, 120));
      },
      () => {
        const img = oneOf(randomElements("img", 1));
        if (img) flashClass(img, "mq-broken", rand(200, 700));
      },
      () => junkBlocks(1),
    ];
    // Louder things that join in as it climbs: [minimum strength, effect].
    const loud: [number, () => void][] = [
      [0.15, () => flashFilter("tear", "url(#mq-tear-f)", rand(50, 160))],
      [0.2, () => junkBlocks(Math.ceil(rand(2, 3 + strength() * 8)))],
      [0.25, () => flashFilter("chan", Math.random() < 0.5 ? "url(#mq-chan-a-f)" : "url(#mq-chan-b-f)", rand(34, 120))],
      [0.3, () => {
        const nodes = textNodes();
        for (let i = 0; i < Math.ceil(strength() * 4) && nodes.length; i++) {
          corrupt(nodes.splice(Math.floor(Math.random() * nodes.length), 1)[0], Math.random() < 0.6 ? mojibake : scramble, rand(100, 500));
        }
      }],
      [0.35, () => flashClass(html, "mq-stutter", 200)],
      [0.4, () => {
        for (const el of randomElements("button, li, [role=button], .rounded-md, .rounded-lg", Math.ceil(strength() * 3))) flashClass(el, "mq-shake", 240);
      }],
      [0.5, () => {
        setFakeOffline(true);
        later(() => setFakeOffline(false), rand(1200, 3500));
      }],
      [0.55, () => {
        // A burst: tear, junk and a dropped channel together, like the GPU choking.
        flashFilter("tear", "url(#mq-tear-f)", 120);
        junkBlocks(6);
        later(() => flashFilter("chan", "url(#mq-chan-b-f)", 60), 80);
      }],
      [0.6, () => {
        const nodes = textNodes();
        for (let i = 0; i < 2 && nodes.length; i++) corrupt(nodes.splice(Math.floor(Math.random() * nodes.length), 1)[0], (t) => zalgo(t, strength()), rand(150, 400));
      }],
      [0.7, () => (Math.random() < 0.5 ? flashFilter("inv", "invert(1) hue-rotate(180deg)", rand(34, 90)) : flashClass(html, "mq-stutter", 200))],
      [0.3, () => {
        // The unravelling: the next notice it has earned, never the same one twice running.
        const earned = THREATS.filter(([min]) => strength() >= min);
        const next = earned[Math.min(earned.length - 1, threatIndex)];
        if (!next || Math.random() > 0.35) return;
        threatIndex = Math.min(THREATS.length - 1, threatIndex + 1);
        useRoomStore.getState().addToast({ id: `glitch-${Date.now()}`, message: next[1], guestVisible: true });
      }],
    ];
    const stillOnly = new Set([1, 2, 3, 4, 5]); // swaps, mojibake, font, blink, broken image: no motion

    // Full-screen RGB split, only during episodes (calm looks completely normal), jumping between offsets
    // in hard steps the way a failing display does.
    let splitOn = false;
    const setSplit = (on: boolean) => {
      splitOn = on;
      html.style.setProperty("--mq-glitch", on ? String(strength()) : "0");
      if (!on) {
        html.style.removeProperty("--mq-f-rgb");
        setRgb(0);
      }
    };
    const splitTick = () => {
      if (splitOn && !reduced) {
        const s = strength();
        const px = Math.random() < 0.3 ? 0 : Math.round(rand(1, 2 + s * 14)) * (Math.random() < 0.5 ? -1 : 1);
        setRgb(px);
        if (px) html.style.setProperty("--mq-f-rgb", "url(#mq-rgb-f)");
        else html.style.removeProperty("--mq-f-rgb");
      }
      later(splitTick, rand(90, 700));
    };
    later(splitTick, 200);

    const episode = () => {
      const g = strength();
      setSplit(true);
      const endAt = Date.now() + rand(4_000, 6_000 + g * 18_000);
      const tick = () => {
        if (Date.now() > endAt) {
          setSplit(false);
          later(episode, calmFor());
          return;
        }
        const s = strength();
        const pool = subtle.filter((_, i) => !reduced || stillOnly.has(i));
        const louds = loud.filter(([min]) => s >= min).map(([, fn]) => fn);
        const fn = !reduced && louds.length && Math.random() < s * 0.6 ? oneOf(louds) : oneOf(pool);
        fn?.();
        later(tick, rand(700, 2600 - s * 1600));
      };
      tick();
    };
    // Calm spells: about 1-2 minutes when it's faint, 10-30s at full strength.
    const calmFor = () => {
      const g = strength();
      return rand(10_000 + (1 - g) * 50_000, 30_000 + (1 - g) * 90_000);
    };
    // Even during calm, the odd single blink: just enough to doubt yourself.
    const stray = () => {
      if (Math.random() < 0.5) oneOf(subtle.filter((_, i) => !reduced || stillOnly.has(i)))?.();
      later(stray, rand(20_000, 60_000));
    };

    setSplit(false);
    later(episode, allOut ? 1_500 : rand(8_000, 25_000));
    later(stray, rand(15_000, 40_000));

    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      html.classList.remove("mq-glitched", "mq-stutter");
      for (const v of ["--mq-glitch", "--mq-f-rgb", "--mq-f-tear", "--mq-f-chan", "--mq-f-inv"]) html.style.removeProperty(v);
      useRoomStore.getState().setFakeOffline(false);
    };
  }, [level, instant]);

  if (level <= 0) return null;
  return (
    <>
      <div className="mq-scanlines pointer-events-none fixed inset-0 z-[95]" aria-hidden />
      {/* Filters the tearing and channel drops use (applied to #root for a frame or two). */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <filter id="mq-tear-f" x="-5%" y="0" width="110%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.00001 0.045" numOctaves="1" seed={seed} result="noise" />
          <feComponentTransfer in="noise" result="bands">
            <feFuncR type="discrete" tableValues="0.5 0.5 0.15 0.5 0.85 0.5 0.5 0.3 0.5" />
          </feComponentTransfer>
          <feColorMatrix in="bands" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="xOnly" />
          <feDisplacementMap in="SourceGraphic" in2="xOnly" scale="70" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="mq-rgb-f" x="-2%" y="0" width="104%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feOffset in="r" dx={rgb} dy="0" result="r2" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feOffset in="b" dx={-rgb} dy={Math.round(rgb / 4)} result="b2" />
          <feBlend in="r2" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b2" mode="screen" />
        </filter>
        <filter id="mq-chan-a-f">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        </filter>
        <filter id="mq-chan-b-f">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0.1  0 0 0 1 0" />
        </filter>
      </svg>
    </>
  );
}
