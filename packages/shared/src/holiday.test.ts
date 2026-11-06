import { describe, it, expect } from "vitest";
import { coverDecorFor } from "./holiday.js";

const d = (iso: string) => new Date(iso);

describe("coverDecorFor (seasonal album cover decorations)", () => {
  it("Christmas songs wear the Santa hat in November and December", () => {
    expect(coverDecorFor("auto", d("2026-11-05T22:00:00"), "Last Christmas")).toBe("santa");
    expect(coverDecorFor("auto", d("2026-12-20T22:00:00"), "Jingle Bell Rock")).toBe("santa");
    expect(coverDecorFor("auto", d("2026-11-05T22:00:00"), "Lost In Translation")).toBeNull();
    // No "Christmas" in the title, but it's off a Christmas album.
    expect(coverDecorFor("auto", d("2026-11-05T22:00:00"), "Santa Tell Me", "Christmas Hits")).toBe("santa");
    expect(coverDecorFor("auto", d("2026-11-05T22:00:00"), "Underneath the Tree", "Wrapped in Red")).toBeNull();
    expect(coverDecorFor("auto", d("2026-11-05T22:00:00"), "Underneath the Tree", "Merry Christmas II You")).toBe("santa");
    expect(coverDecorFor("auto", d("2026-07-05T22:00:00"), "Last Christmas")).toBeNull();
  });

  it("October's spooky songs get a witch's hat or horns, the same one every time", () => {
    const first = coverDecorFor("auto", d("2026-10-20T22:00:00"), "Thriller");
    expect(["witch", "horns"]).toContain(first);
    expect(coverDecorFor("auto", d("2026-10-02T22:00:00"), "Thriller")).toBe(first);
    expect(coverDecorFor("auto", d("2026-10-20T22:00:00"), "Dancing Queen")).toBeNull();
  });

  it("February's love songs get Cupid's bow", () => {
    expect(coverDecorFor("auto", d("2026-02-14T22:00:00"), "Crazy in Love")).toBe("cupid");
    expect(coverDecorFor("auto", d("2026-03-14T22:00:00"), "Crazy in Love")).toBeNull();
  });

  it("a forced mode applies all year; off never decorates", () => {
    expect(coverDecorFor("christmas", d("2026-07-05T22:00:00"), "Last Christmas")).toBe("santa");
    expect(["witch", "horns"]).toContain(coverDecorFor("halloween", d("2026-07-05T22:00:00"), "Monster Mash"));
    expect(coverDecorFor("off", d("2026-12-20T22:00:00"), "Last Christmas")).toBeNull();
  });
});
