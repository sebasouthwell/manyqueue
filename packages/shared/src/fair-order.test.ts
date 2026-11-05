import { describe, it, expect } from "vitest";
import { fairOrder, type FairOrderItem } from "./fair-order.js";

function item(id: string, addedBy: string | null, pinnedPosition: number | null = null): FairOrderItem {
  return { id, addedBy, pinnedPosition };
}

function ids(items: FairOrderItem[]): string[] {
  return items.map((i) => i.id);
}

describe("fairOrder", () => {
  it("one guest adds 5 songs, another adds 1 — the single song is 2nd", () => {
    const items = [
      item("a1", "A"),
      item("a2", "A"),
      item("a3", "A"),
      item("a4", "A"),
      item("a5", "A"),
      item("b1", "B"),
    ];
    const result = fairOrder(items, []);
    expect(ids(result)).toEqual(["a1", "b1", "a2", "a3", "a4", "a5"]);
  });

  it("a new guest joining late still gets an early turn next round", () => {
    // A has 2 already queued; B joins late with 1.
    const items = [item("a1", "A"), item("a2", "A"), item("b1", "B")];
    const result = fairOrder(items, []);
    expect(ids(result)).toEqual(["a1", "b1", "a2"]);
  });

  it("the guest who played most recently goes last in the rotation", () => {
    const items = [item("a1", "A"), item("b1", "B"), item("c1", "C")];
    // B played most recently, then A. C has never played.
    const result = fairOrder(items, ["B", "A"]);
    expect(ids(result)).toEqual(["c1", "a1", "b1"]);
  });

  it("house picks only fill gaps after every guest's songs are placed", () => {
    const items = [item("h1", null), item("a1", "A"), item("h2", null), item("b1", "B")];
    const result = fairOrder(items, []);
    expect(ids(result)).toEqual(["a1", "b1", "h1", "h2"]);
  });

  it("a pinned item stays at its slot and the rest work around it", () => {
    const items = [
      item("a1", "A"),
      item("a2", "A", 2), // pinned at slot 2 (1-indexed)
      item("b1", "B"),
    ];
    const result = fairOrder(items, []);
    // Slot 2 is locked to a2. Round-robin over the rest (a1, b1) fills 1 and 3.
    expect(result[1].id).toBe("a2");
    expect(ids(result)).toEqual(["a1", "a2", "b1"]);
  });

  it("a guest who leaves (no longer has any queued songs) just drops out of rotation", () => {
    const items = [item("b1", "B"), item("c1", "C")];
    // A had played before but has nothing queued now — must not appear or crash.
    const result = fairOrder(items, ["A", "B"]);
    expect(ids(result)).toEqual(["c1", "b1"]);
  });

  it("is a no-op on an already-fair single-guest queue", () => {
    const items = [item("a1", "A"), item("a2", "A")];
    expect(ids(fairOrder(items, []))).toEqual(["a1", "a2"]);
  });

  it("handles an empty queue", () => {
    expect(fairOrder([], [])).toEqual([]);
  });
});
