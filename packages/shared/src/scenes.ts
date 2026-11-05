/**
 * Genre scenes: the TV's background follows the song's genre (warm for salsa, neon for EDM...). The genre tags
 * come from the genre cache, most fitting first, so the first tag counts most.
 */

export type SceneId = "latin" | "neon" | "rock" | "hiphop" | "pop" | "chill" | "country" | "classic";

export interface SceneDef {
  id: SceneId;
  name: string;
  /** Words that put a tag in this scene (checked as whole words or phrases inside the tag). */
  keywords: string[];
  /** Three colours, as "r g b", that the TV blends into the background. */
  colors: [string, string, string];
}

/** Listed in priority order: on a tie the earlier scene wins. "classic" is the plain fallback, never matched. */
export const SCENES: SceneDef[] = [
  { id: "latin", name: "Latin", keywords: ["latin", "salsa", "reggaeton", "bachata", "merengue", "cumbia", "urbano", "tropical", "flamenco", "mariachi", "bossa nova", "samba"], colors: ["251 146 60", "244 63 94", "250 204 21"] },
  { id: "neon", name: "Neon", keywords: ["edm", "electronic", "electro", "house", "techno", "trance", "dubstep", "drum and bass", "dnb", "club", "rave", "synthwave"], colors: ["34 211 238", "217 70 239", "99 102 241"] },
  { id: "rock", name: "Rock", keywords: ["rock", "metal", "punk", "grunge", "hardcore", "emo", "shoegaze"], colors: ["220 38 38", "120 20 20", "245 158 11"] },
  { id: "hiphop", name: "Hip hop", keywords: ["hip hop", "hip-hop", "rap", "trap", "grime", "drill", "boom bap"], colors: ["250 204 21", "139 92 246", "24 24 27"] },
  { id: "country", name: "Country", keywords: ["country", "bluegrass", "americana", "honky tonk", "western"], colors: ["217 119 6", "180 83 9", "252 211 77"] },
  { id: "chill", name: "Chill", keywords: ["r&b", "rnb", "soul", "jazz", "lo-fi", "lofi", "ambient", "chill", "acoustic", "folk", "classical", "blues", "downtempo", "trip hop"], colors: ["20 184 166", "79 70 229", "56 189 248"] },
  { id: "pop", name: "Pop", keywords: ["pop", "k-pop", "kpop", "disco", "funk", "dance"], colors: ["244 114 182", "251 146 60", "167 139 250"] },
  { id: "classic", name: "Classic", keywords: [], colors: ["99 102 241", "139 92 246", "56 189 248"] },
];

export function sceneById(id: SceneId): SceneDef {
  return SCENES.find((s) => s.id === id) ?? SCENES[SCENES.length - 1]!;
}

function tagMatches(tag: string, keyword: string): boolean {
  const t = ` ${tag.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim()} `;
  const k = ` ${keyword.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim()} `;
  return t.includes(k);
}

/** Weight of the 1st, 2nd and 3rd tag. */
const TAG_WEIGHTS = [3, 2, 1];

/** The scene for a song's genre tags, or null when the tags say nothing (the TV keeps its plain background). */
export function sceneForGenres(genres: readonly string[]): SceneId | null {
  const scores = new Map<SceneId, number>();
  genres.slice(0, TAG_WEIGHTS.length).forEach((tag, i) => {
    for (const scene of SCENES) {
      if (scene.keywords.some((k) => tagMatches(tag, k))) {
        // A tag counts for the FIRST scene it fits, so "dance pop" is pop, not neon.
        scores.set(scene.id, (scores.get(scene.id) ?? 0) + TAG_WEIGHTS[i]!);
        break;
      }
    }
  });
  let best: SceneId | null = null;
  let bestScore = 0;
  for (const scene of SCENES) {
    const score = scores.get(scene.id) ?? 0;
    if (score > bestScore) {
      best = scene.id;
      bestScore = score;
    }
  }
  return best;
}
