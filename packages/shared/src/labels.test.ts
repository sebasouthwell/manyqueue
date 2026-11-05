import { describe, expect, it } from "vitest";
import { EMPTY_LABEL_STATS, computeLabels, titleCase, topGenre, type LabelStats } from "./labels";

const stats = (over: Partial<LabelStats>): LabelStats => ({ ...EMPTY_LABEL_STATS, genreSongs: {}, ...over });

describe("computeLabels", () => {
  it("earns nothing from an empty night and shows progress for everything", () => {
    const r = computeLabels(EMPTY_LABEL_STATS);
    expect(r.earned).toEqual([]);
    expect(r.progress.length).toBeGreaterThanOrEqual(8);
  });

  it("earns a genre label named after the genre queued most", () => {
    const r = computeLabels(stats({ genreSongs: { salsa: 3, pop: 1 } }));
    expect(r.earned.map((l) => [l.key, l.name])).toEqual([["genre-pro:salsa", "Salsa Pro"]]);
  });

  it("does not earn a genre label below three songs, and shows the leading genre as progress", () => {
    const r = computeLabels(stats({ genreSongs: { "hip hop": 2 } }));
    expect(r.earned).toEqual([]);
    expect(r.progress[0]).toMatchObject({ key: "genre-pro", name: "Hip Hop Pro", value: 2, target: 3 });
  });

  it("breaks genre ties towards the genre seen first (an artist's main tag), so the label is stable", () => {
    expect(topGenre({ reggaeton: 4, "latin trap": 4 })).toEqual({ genre: "reggaeton", count: 4 });
    expect(topGenre({})).toBeNull();
  });

  it("earns each rule at its threshold", () => {
    const r = computeLabels(stats({ bestSongReactions: 8, reactionsReceived: 20, fireReactions: 12, skipped: 3, contestsWon: 2, timesGuessedRight: 2, heartsReceived: 3, songsAdded: 8 }));
    expect(r.earned.map((l) => l.key).sort()).toEqual(["certified-skip", "contest-champ", "crowd-pleaser", "fire-starter", "heartbreaker", "hitmaker", "marathon", "mind-reader"]);
  });

  it("orders progress by how close each label is, and caps values at the target", () => {
    const r = computeLabels(stats({ contestsWon: 1, heartsReceived: 2, skipped: 1 }));
    expect(r.progress[0]!.key).toBe("heartbreaker"); // 2/3 beats 1/2 and 1/3
    expect(computeLabels(stats({ skipped: 99 })).earned[0]!.value).toBe(3);
  });

  it("title-cases genres", () => {
    expect(titleCase("hip hop")).toBe("Hip Hop");
    expect(titleCase("r&b")).toBe("R&B");
  });
});
