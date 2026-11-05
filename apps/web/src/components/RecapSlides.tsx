import { useEffect, useState } from "react";
import { RECAP_SLIDE_MS, formatNightLength, recapSlides, type RecapData, type RecapGuest, type RecapSlide, type RecapSong } from "@manyqueue/shared";
import { Emoji, EmojiText } from "./Emoji";
import { QrCode } from "./QrCode";

const STAGE = { width: 1920, height: 1080 };

function Art({ song, size }: { song: RecapSong; size: number }) {
  return song.albumArtUrl ? (
    <img src={song.albumArtUrl} alt="" style={{ width: size, height: size, borderRadius: 18 }} className="shadow-2xl" />
  ) : (
    <div style={{ width: size, height: size, borderRadius: 18 }} className="bg-gradient-to-br from-accent-700 to-accent-900 shadow-2xl" />
  );
}

function Hero({ recap }: { recap: RecapData }) {
  const stats: [string, string][] = [
    [formatNightLength(recap.room.durationMs), "the night ran"],
    [String(recap.totals.songs), "songs played"],
    [String(recap.totals.guests), "guests"],
    [String(recap.totals.reactions), "reactions"],
  ];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
      <p className="font-bold text-accent-100" style={{ fontSize: 110, letterSpacing: "-0.02em" }}>
        That was {recap.room.name}
      </p>
      <p className="text-accent-300 uppercase" style={{ marginTop: 14, fontSize: 30, letterSpacing: "0.4em", paddingLeft: "0.4em" }}>
        the night in numbers
      </p>
      <div className="flex" style={{ marginTop: 90, gap: 110 }}>
        {stats.map(([value, label]) => (
          <div key={label}>
            <p className="font-bold tabular-nums text-accent-100" style={{ fontSize: 120, lineHeight: 1 }}>
              {value}
            </p>
            <p className="text-accent-200" style={{ marginTop: 12, fontSize: 34 }}>
              {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SongSlide({ title, song, caption }: { title: string; song: RecapSong; caption: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ gap: 90 }}>
      <Art song={song} size={560} />
      <div style={{ width: 900 }}>
        <p className="text-accent-300 uppercase" style={{ fontSize: 34, letterSpacing: "0.35em" }}>
          {title}
        </p>
        <p className="font-bold leading-tight text-accent-100" style={{ marginTop: 22, fontSize: 96, letterSpacing: "-0.02em" }}>
          {song.title}
        </p>
        <p className="text-accent-200" style={{ marginTop: 12, fontSize: 48 }}>
          {song.artist}
        </p>
        <p className="flex items-center gap-3 text-accent-200" style={{ marginTop: 34, fontSize: 40 }}>
          <EmojiText text={caption} size={42} />
        </p>
        {song.by && (
          <p className="flex items-center gap-3 text-accent-300" style={{ marginTop: 14, fontSize: 34 }}>
            Queued by <Emoji value={song.by.emoji} size={38} /> {song.by.name}
          </p>
        )}
      </div>
    </div>
  );
}

function BannedSlide({ recap }: { recap: RecapData }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
      <p className="text-accent-300 uppercase" style={{ fontSize: 34, letterSpacing: "0.35em" }}>
        Banned by the room
      </p>
      <div style={{ marginTop: 40, maxWidth: 1400 }} className="flex flex-col gap-5">
        {recap.banned.slice(0, 5).map((b, i) => (
          <p key={i} className="font-semibold text-accent-100" style={{ fontSize: 72 }}>
            {b.title}
            {b.artist && <span className="text-accent-300"> · {b.artist}</span>}
          </p>
        ))}
      </div>
    </div>
  );
}

function GuestRow({ g }: { g: RecapGuest }) {
  return (
    <div className="flex items-center rounded-3xl bg-section/80" style={{ gap: 30, padding: "16px 36px", width: 1500 }}>
      <Emoji value={g.emoji} size={88} />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate font-bold text-accent-100" style={{ fontSize: 46 }}>
          {g.name}
        </p>
        {g.nickname && (
          <p className="truncate text-accent-200" style={{ fontSize: 32 }}>
            <Emoji value="✨" size={30} /> <EmojiText text={g.nickname.nickname} size={32} />
          </p>
        )}
        {g.labels.length > 0 && (
          <div className="flex flex-wrap" style={{ marginTop: 8, gap: 10 }}>
            {g.labels.slice(0, 4).map((l) => (
              <span key={l.name} className="inline-flex items-center rounded-full bg-accent-700/50 text-accent-100" style={{ gap: 8, padding: "2px 18px", fontSize: 25 }}>
                <Emoji value={l.emoji} size={25} /> {l.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="text-right tabular-nums text-accent-200" style={{ fontSize: 28 }}>
        <p>{g.songs} song{g.songs === 1 ? "" : "s"}</p>
        <p className="text-accent-300">{g.reactionsGot} reactions</p>
      </div>
    </div>
  );
}

function CrewSlide({ slide }: { slide: Extract<RecapSlide, { kind: "crew" }> }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: 16, paddingBottom: 30 }}>
      <p className="text-accent-300 uppercase" style={{ fontSize: 30, letterSpacing: "0.35em", marginBottom: 4 }}>
        The crew{slide.pages > 1 ? ` · ${slide.page}/${slide.pages}` : ""}
      </p>
      {slide.guests.map((g, i) => (
        <GuestRow key={i} g={g} />
      ))}
    </div>
  );
}

function Thanks({ recapUrl }: { recapUrl: string | null }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
      <p className="font-medium text-accent-100" style={{ fontSize: 120 }}>
        Thanks for coming <Emoji value="💜" size={110} />
      </p>
      {recapUrl && (
        <div className="flex items-center rounded-3xl bg-accent-900" style={{ marginTop: 70, gap: 40, padding: 28 }}>
          <div className="rounded-xl bg-accent-100" style={{ padding: 10 }}>
            <QrCode value={recapUrl} size={240} />
          </div>
          <div className="text-left">
            <p className="font-semibold text-accent-100" style={{ fontSize: 48 }}>
              Your night's recap
            </p>
            <p className="text-accent-200" style={{ marginTop: 8, fontSize: 32 }}>
              Scan to keep it
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The TV after "End night": the recap plays as full-stage slides, 6s each, ending on the thanks slide with a QR
 * code to the recap page. The data is fetched when it starts and again at the first crew slide, so nicknames the
 * AI finishes making just after the night ended still make it in.
 */
export function RecapSlides({ code, baseUrl, demoData }: { code: string; baseUrl: string; demoData?: RecapData }) {
  const [recap, setRecap] = useState<RecapData | null>(demoData ?? null);
  const [key, setKey] = useState<string | null>(demoData ? "demo" : null);
  const [index, setIndex] = useState(0);
  const [refetched, setRefetched] = useState(false);

  const load = () =>
    demoData ? Promise.resolve() : fetch(`/rooms/${code}/recap.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setRecap(d.recap);
        if (d.key) setKey(d.key);
      })
      .catch(() => {});

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const slides = recap ? recapSlides(recap) : [];
  const slide = slides[Math.min(index, Math.max(0, slides.length - 1))];

  useEffect(() => {
    if (slides.length === 0 || index >= slides.length - 1) return;
    const t = setTimeout(() => setIndex((i) => i + 1), RECAP_SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, slides.length]);

  useEffect(() => {
    if (slide?.kind === "crew" && !refetched) {
      setRefetched(true);
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.kind]);

  if (!recap || !slide) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="font-medium text-accent-100" style={{ fontSize: 88 }}>
          Thanks for coming <Emoji value="💜" size={80} />
        </p>
      </div>
    );
  }

  const recapUrl = key ? `${baseUrl}/rooms/${code}/recap?key=${key}` : null;
  return (
    <div className="absolute inset-0" style={{ width: STAGE.width, height: STAGE.height }}>
      <div key={index} className="absolute inset-0" style={{ animation: "mq-recap-in 600ms ease both" }}>
        <style>{`@keyframes mq-recap-in { from { opacity: 0; transform: scale(0.985) } to { opacity: 1; transform: scale(1) } }`}</style>
        {slide.kind === "hero" && <Hero recap={recap} />}
        {slide.kind === "song" && <SongSlide title={slide.title} song={slide.song} caption={slide.caption} />}
        {slide.kind === "banned" && <BannedSlide recap={recap} />}
        {slide.kind === "crew" && <CrewSlide slide={slide} />}
        {slide.kind === "thanks" && <Thanks recapUrl={recapUrl} />}
      </div>
      <div className="absolute flex" style={{ bottom: 44, left: 96, gap: 14 }}>
        {slides.map((_, i) => (
          <span key={i} className="rounded-full" style={{ width: 14, height: 14, background: i === index ? "rgb(var(--color-accent-100))" : "rgb(var(--color-accent-700))" }} />
        ))}
      </div>
    </div>
  );
}
