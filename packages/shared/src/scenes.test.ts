import { describe, expect, it } from "vitest";
import { SCENES, sceneById, sceneForGenres } from "./scenes";

describe("sceneForGenres", () => {
  it("maps the obvious genres", () => {
    expect(sceneForGenres(["salsa"])).toBe("latin");
    expect(sceneForGenres(["reggaeton", "latin trap"])).toBe("latin");
    expect(sceneForGenres(["edm", "house"])).toBe("neon");
    expect(sceneForGenres(["french house", "electronic"])).toBe("neon");
    expect(sceneForGenres(["heavy metal", "rock"])).toBe("rock");
    expect(sceneForGenres(["hip hop", "rap"])).toBe("hiphop");
    expect(sceneForGenres(["jazz"])).toBe("chill");
    expect(sceneForGenres(["country"])).toBe("country");
    expect(sceneForGenres(["pop", "dance pop"])).toBe("pop");
  });

  it("lets the first tag count most", () => {
    expect(sceneForGenres(["reggaeton", "latin trap", "pop"])).toBe("latin"); // 3+2 beats pop's 1
    expect(sceneForGenres(["pop", "rock", "rock"])).toBe("rock"); // pop 3 vs rock 2+1: a tie, and the earlier scene in the list wins
    expect(sceneForGenres(["pop", "pop", "rock"])).toBe("pop"); // 3+2 vs 1
  });

  it("puts a tag in the first scene it fits: dance pop is pop, not neon", () => {
    expect(sceneForGenres(["dance pop"])).toBe("pop");
  });

  it("matches whole words, so 'hip hop' is not 'pop' and 'trap' is not 'rap'", () => {
    expect(sceneForGenres(["hip hop"])).toBe("hiphop");
    expect(sceneForGenres(["latin trap"])).toBe("latin");
    expect(sceneForGenres(["synthpop"])).toBeNull(); // unknown compound: no guess
  });

  it("says nothing when the tags don't fit or there are none", () => {
    expect(sceneForGenres([])).toBeNull();
    expect(sceneForGenres(["zydeco"])).toBeNull();
  });

  it("only looks at the first three tags", () => {
    expect(sceneForGenres(["zydeco", "zouk", "vaporwave", "salsa"])).toBeNull();
  });
});

describe("scenes", () => {
  it("has eight, with a plain fallback", () => {
    expect(SCENES).toHaveLength(8);
    expect(sceneById("classic").keywords).toEqual([]);
    expect(SCENES.every((s) => s.colors.length === 3)).toBe(true);
  });
});
