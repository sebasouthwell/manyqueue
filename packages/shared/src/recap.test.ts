import { describe, expect, it } from "vitest";
import { formatNightLength, recapSlides, type RecapData, type RecapGuest } from "./recap";

const guest = (name: string, songs = 1): RecapGuest => ({ name, emoji: "🐸", songs, reactionsGot: 0, labels: [], nickname: null });
const base = (over: Partial<RecapData> = {}): RecapData => ({
  room: { name: "Party", code: "ABCD", startedAt: 0, endedAt: 1, durationMs: 3_600_000 },
  totals: { songs: 5, guests: 3, reactions: 12 },
  songOfTheNight: null,
  mostReplayed: null,
  banned: [],
  guests: [],
  ...over,
});

describe("formatNightLength", () => {
  it("reads naturally", () => {
    expect(formatNightLength(10_000)).toBe("under a minute");
    expect(formatNightLength(45 * 60_000)).toBe("45 min");
    expect(formatNightLength(2 * 3_600_000)).toBe("2 h");
    expect(formatNightLength(3 * 3_600_000 + 20 * 60_000)).toBe("3 h 20 min");
  });
});

describe("recapSlides", () => {
  it("is just the hero and the thanks for a quiet night", () => {
    expect(recapSlides(base()).map((s) => s.kind)).toEqual(["hero", "thanks"]);
  });

  it("adds a slide for each thing that happened, and pages the crew", () => {
    const song = { title: "T", artist: "A", albumArtUrl: null, by: null };
    const slides = recapSlides(
      base({
        songOfTheNight: { ...song, fire: 9, reactions: 12 },
        mostReplayed: { ...song, plays: 3 },
        banned: [{ title: "x", artist: "y" }],
        guests: ["a", "b", "c", "d", "e"].map((n) => guest(n)),
      }),
    );
    expect(slides.map((s) => s.kind)).toEqual(["hero", "song", "song", "banned", "crew", "crew", "thanks"]);
    expect(slides.filter((s) => s.kind === "crew").map((s) => (s.kind === "crew" ? s.guests.length : 0))).toEqual([4, 1]);
  });

  it("leaves silent guests out of the crew slides", () => {
    const slides = recapSlides(base({ guests: [guest("quiet", 0), guest("busy", 2)] }));
    const crew = slides.find((s) => s.kind === "crew");
    expect(crew && crew.kind === "crew" ? crew.guests.map((g) => g.name) : []).toEqual(["busy"]);
  });
});
