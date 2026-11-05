import { describe, it, expect } from "vitest";
import { reduceMoments, initialMomentState, type Moment, type MomentState } from "./moments.js";

function m(id: string, priority: 1 | 2 | 3, extra: Partial<Moment> = {}): Moment {
  return { id, kind: "demo", priority, payload: null, minMs: 5000, ...extra };
}
const show = (s: MomentState, moment: Moment, now: number) => reduceMoments(s, { type: "show", moment }, now);
const tick = (s: MomentState, now: number) => reduceMoments(s, { type: "tick" }, now);
const end = (s: MomentState, id: string, now: number) => reduceMoments(s, { type: "end", id }, now);

describe("moment queue", () => {
  it("shows the first moment immediately", () => {
    const s = show(initialMomentState, m("a", 2), 0);
    expect(s.current?.moment.id).toBe("a");
  });

  it("contest, reveal and dedication fired together: contest first, reveal next, then dedication", () => {
    let s = initialMomentState;
    s = show(s, m("dedication", 3), 0);
    s = show(s, m("reveal", 2), 0);
    s = show(s, m("contest", 1), 0);
    // all three arrived in the same instant, so arrival order doesn't matter:
    expect(s.current?.moment.id).toBe("contest");
    s = end(s, "contest", 6000);
    expect(s.current?.moment.id).toBe("reveal");
    s = end(s, "reveal", 7000);
    expect(s.current?.moment.id).toBe("dedication");
  });

  it("a moment that's been up a while is not bumped by a later, more urgent one until min_ms", () => {
    let s = show(initialMomentState, m("dedication", 3, { minMs: 3000 }), 0);
    s = show(s, m("contest", 1), 1000);
    expect(s.current?.moment.id).toBe("dedication");
    s = tick(s, 3000);
    expect(s.current?.moment.id).toBe("contest");
    // ...and the bumped one is re-queued, not lost
    s = end(s, "contest", 4000);
    expect(s.current?.moment.id).toBe("dedication");
  });

  it("a higher priority arriving cold goes straight up when nothing is current", () => {
    let s = show(initialMomentState, m("a", 3), 0);
    s = end(s, "a", 1);
    s = show(s, m("c", 1), 2);
    expect(s.current?.moment.id).toBe("c");
  });

  it("a higher priority waits for the current moment's min_ms", () => {
    let s = show(initialMomentState, m("reveal", 2, { minMs: 4000 }), 0);
    s = show(s, m("contest", 1), 1000);
    expect(s.current?.moment.id).toBe("reveal");
    s = tick(s, 3999);
    expect(s.current?.moment.id).toBe("reveal");
    s = tick(s, 4000);
    expect(s.current?.moment.id).toBe("contest");
  });

  it("the same priority waits its turn, in order", () => {
    let s = show(initialMomentState, m("r1", 2), 0);
    s = show(s, m("r2", 2), 0);
    s = show(s, m("r3", 2), 0);
    s = tick(s, 60_000);
    expect(s.current?.moment.id).toBe("r1"); // never replaced by an equal
    s = end(s, "r1", 60_001);
    expect(s.current?.moment.id).toBe("r2");
    s = end(s, "r2", 60_002);
    expect(s.current?.moment.id).toBe("r3");
  });

  it("a lower priority never replaces a higher one", () => {
    let s = show(initialMomentState, m("c", 1), 0);
    s = show(s, m("d", 3), 0);
    s = tick(s, 999_999);
    expect(s.current?.moment.id).toBe("c");
  });

  it("a moment ends by itself at `until`, promoting the next", () => {
    let s = show(initialMomentState, m("a", 2, { until: 10_000 }), 0);
    s = show(s, m("b", 2), 0);
    s = tick(s, 9_999);
    expect(s.current?.moment.id).toBe("a");
    s = tick(s, 10_000);
    expect(s.current?.moment.id).toBe("b");
  });

  it("a queued moment that expires while waiting never shows", () => {
    let s = show(initialMomentState, m("a", 2), 0);
    s = show(s, m("stale", 2, { until: 1000 }), 0);
    s = end(s, "a", 2000);
    expect(s.current).toBeNull();
    expect(s.queue).toEqual([]);
  });

  it("a replaced moment that has expired isn't re-queued", () => {
    let s = show(initialMomentState, m("d", 3, { until: 6000 }), 0);
    s = show(s, m("c", 1), 0);
    s = tick(s, 5000);
    expect(s.current?.moment.id).toBe("c");
    s = end(s, "c", 7000);
    expect(s.current).toBeNull();
  });

  it("ignores a duplicate show for a moment already current or queued", () => {
    let s = show(initialMomentState, m("a", 2), 0);
    s = show(s, m("a", 2), 1);
    s = show(s, m("b", 2), 1);
    s = show(s, m("b", 2), 2);
    expect(s.queue.map((x) => x.id)).toEqual(["b"]);
  });

  it("ending a queued moment removes it", () => {
    let s = show(initialMomentState, m("a", 2), 0);
    s = show(s, m("b", 2), 0);
    s = end(s, "b", 1);
    expect(s.queue).toEqual([]);
  });
});
