/** The end-of-night recap: built from data the app already keeps, shown as a page and as TV slides. */

export interface RecapSong {
  title: string;
  artist: string;
  albumArtUrl: string | null;
  /** Who queued it; null for house picks and for mystery picks that were never revealed. */
  by: { name: string; emoji: string } | null;
}

export interface RecapGuest {
  name: string;
  emoji: string;
  songs: number;
  reactionsGot: number;
  labels: { emoji: string; name: string }[];
  /** The AI nickname the guest was showing at the end, if any (hidden ones never appear). */
  nickname: { nickname: string; why: string } | null;
}

export interface RecapData {
  room: { name: string; code: string; startedAt: number; endedAt: number | null; durationMs: number };
  totals: { songs: number; guests: number; reactions: number };
  /** The song that got the most 🔥. */
  songOfTheNight: (RecapSong & { fire: number; reactions: number }) | null;
  /** The song played most often tonight (2 plays or more). */
  mostReplayed: (RecapSong & { plays: number }) | null;
  banned: { title: string; artist: string }[];
  /** Most active first. */
  guests: RecapGuest[];
}

/** "3 h 20 min", "45 min", "under a minute". */
export function formatNightLength(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** How long each TV recap slide stays up. */
export const RECAP_SLIDE_MS = 6_000;
/** Guests shown per "crew" slide on the TV. */
export const RECAP_GUESTS_PER_SLIDE = 4;

export type RecapSlide =
  | { kind: "hero" }
  | { kind: "song"; title: string; song: RecapSong; caption: string }
  | { kind: "banned" }
  | { kind: "crew"; guests: RecapGuest[]; page: number; pages: number }
  | { kind: "thanks" };

/** The TV slideshow for a recap: only slides that have something to say, always ending on the thanks slide. */
export function recapSlides(recap: RecapData): RecapSlide[] {
  const slides: RecapSlide[] = [{ kind: "hero" }];
  if (recap.songOfTheNight) {
    const s = recap.songOfTheNight;
    slides.push({ kind: "song", title: "Song of the night", song: s, caption: `${s.fire} 🔥 from the room` });
  }
  if (recap.mostReplayed) {
    const s = recap.mostReplayed;
    slides.push({ kind: "song", title: "Most replayed", song: s, caption: `Played ${s.plays} times tonight` });
  }
  if (recap.banned.length > 0) slides.push({ kind: "banned" });
  // Guests who did something first; quiet ones round the crew out only if there is room.
  const crew = recap.guests.filter((g) => g.songs > 0 || g.labels.length > 0 || g.nickname);
  const pages = Math.ceil(crew.length / RECAP_GUESTS_PER_SLIDE);
  for (let p = 0; p < pages; p++) {
    slides.push({ kind: "crew", guests: crew.slice(p * RECAP_GUESTS_PER_SLIDE, (p + 1) * RECAP_GUESTS_PER_SLIDE), page: p + 1, pages });
  }
  slides.push({ kind: "thanks" });
  return slides;
}
