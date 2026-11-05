/**
 * Labels: earned titles like "Salsa Pro", "Hitmaker 🎯" and "Certified Skip 💀". Each one is a plain rule over
 * numbers the app already keeps (genre counts, skips, reactions, contest wins, guesses). No AI involved in
 * the rules themselves, and once earned a label is never taken away.
 */

export interface LabelStats {
  /** Songs the guest added that count (a still-hidden mystery pick never does, so a label can't point at its owner). */
  songsAdded: number;
  /** Their songs that are over: played or skipped. */
  finished: number;
  skipped: number;
  reactionsReceived: number;
  fireReactions: number;
  /** The most reactions any single one of their songs got. */
  bestSongReactions: number;
  heartsReceived: number;
  contestsWon: number;
  timesGuessedRight: number;
  /** Songs per genre tag (each song counts once for each of its tags). */
  genreSongs: Record<string, number>;
}

export const EMPTY_LABEL_STATS: LabelStats = {
  songsAdded: 0,
  finished: 0,
  skipped: 0,
  reactionsReceived: 0,
  fireReactions: 0,
  bestSongReactions: 0,
  heartsReceived: 0,
  contestsWon: 0,
  timesGuessedRight: 0,
  genreSongs: {},
};

export interface LabelView {
  /** Stable per label (and per genre for the genre label): what's stored, so a label is only earned once. */
  key: string;
  emoji: string;
  name: string;
  /** How to earn it, in a few words. */
  how: string;
  value: number;
  target: number;
}

interface LabelRule {
  id: string;
  emoji: string;
  name: string;
  how: string;
  target: number;
  value: (s: LabelStats) => number;
}

/** Songs in one genre for the "<Genre> Pro" label. */
export const GENRE_PRO_TARGET = 3;

const RULES: LabelRule[] = [
  { id: "hitmaker", emoji: "🎯", name: "Hitmaker", how: "One of your songs gets 8+ reactions", target: 8, value: (s) => s.bestSongReactions },
  { id: "crowd-pleaser", emoji: "🙌", name: "Crowd Pleaser", how: "Get 20 reactions across your songs", target: 20, value: (s) => s.reactionsReceived },
  { id: "fire-starter", emoji: "🔥", name: "Fire Starter", how: "Get 12 🔥 reactions", target: 12, value: (s) => s.fireReactions },
  { id: "certified-skip", emoji: "💀", name: "Certified Skip", how: "Have 3 of your songs skipped", target: 3, value: (s) => s.skipped },
  { id: "contest-champ", emoji: "🏆", name: "Contest Champ", how: "Win 2 song contests", target: 2, value: (s) => s.contestsWon },
  { id: "mind-reader", emoji: "🔮", name: "Mind Reader", how: "Guess who queued 2 mystery songs", target: 2, value: (s) => s.timesGuessedRight },
  { id: "heartbreaker", emoji: "💜", name: "Heartbreaker", how: "Get 3 hearts on your songs", target: 3, value: (s) => s.heartsReceived },
  { id: "marathon", emoji: "🏃", name: "Marathon", how: "Add 8 songs in one night", target: 8, value: (s) => s.songsAdded },
];

/** "hip hop" -> "Hip Hop". */
export function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** The genre a guest queued most, or null. A tie goes to the genre seen first: tags are listed best-fitting
 * first, so an artist's main genre beats their secondary ones (keep the object's insertion order). */
export function topGenre(genreSongs: Record<string, number>): { genre: string; count: number } | null {
  let best: { genre: string; count: number } | null = null;
  for (const [genre, count] of Object.entries(genreSongs)) {
    if (!best || count > best.count) best = { genre, count };
  }
  return best;
}

export interface LabelResult {
  earned: LabelView[];
  /** Not earned yet, closest first. */
  progress: LabelView[];
}

/** Every label the stats earn right now, and how far along the rest are. */
export function computeLabels(stats: LabelStats): LabelResult {
  const all: LabelView[] = RULES.map((r) => ({
    key: r.id,
    emoji: r.emoji,
    name: r.name,
    how: r.how,
    value: Math.min(r.value(stats), r.target),
    target: r.target,
  }));

  const top = topGenre(stats.genreSongs);
  all.unshift({
    key: top && top.count >= GENRE_PRO_TARGET ? `genre-pro:${top.genre}` : "genre-pro",
    emoji: "🎧",
    name: top ? `${titleCase(top.genre)} Pro` : "Genre Pro",
    how: `Queue ${GENRE_PRO_TARGET} songs in the same genre`,
    value: Math.min(top?.count ?? 0, GENRE_PRO_TARGET),
    target: GENRE_PRO_TARGET,
  });

  const earned = all.filter((l) => l.value >= l.target);
  const progress = all
    .filter((l) => l.value < l.target)
    .sort((a, b) => b.value / b.target - a.value / a.target);
  return { earned, progress };
}
