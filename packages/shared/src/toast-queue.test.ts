import { describe, it, expect } from "vitest";
import { addToast, tickToasts, initialToastState, joinMessage, TOAST_MS, type ToastState } from "./toast-queue.js";

const t = (id: string) => ({ id, message: id });
const join = (id: string, nickname: string, emoji = "🦋") => ({
  id,
  message: `${emoji} ${nickname} joined`,
  joins: [{ emoji, nickname }],
});

describe("toast queue", () => {
  it("shows one at a time, first in first out, 4s each", () => {
    let s: ToastState = initialToastState;
    for (const id of ["a", "b", "c"]) s = addToast(s, t(id), 0);
    expect(s.current?.toast.id).toBe("a");
    s = tickToasts(s, TOAST_MS - 1);
    expect(s.current?.toast.id).toBe("a");
    s = tickToasts(s, TOAST_MS);
    expect(s.current?.toast.id).toBe("b");
    s = tickToasts(s, TOAST_MS * 2);
    expect(s.current?.toast.id).toBe("c");
    s = tickToasts(s, TOAST_MS * 3);
    expect(s.current).toBeNull();
  });

  it("keeps at most 5 waiting, dropping the stalest", () => {
    let s: ToastState = initialToastState;
    for (let i = 0; i < 8; i++) s = addToast(s, t(`t${i}`), 0);
    expect(s.current?.toast.id).toBe("t0");
    expect(s.queue.map((x) => x.id)).toEqual(["t3", "t4", "t5", "t6", "t7"]);
  });

  it("merges waiting joins into one line", () => {
    let s: ToastState = initialToastState;
    s = addToast(s, t("first"), 0); // occupies the slot
    s = addToast(s, join("j1", "Maya"), 0);
    s = addToast(s, join("j2", "Sam", "🐸"), 0);
    s = addToast(s, join("j3", "Ali", "🦊"), 0);
    s = addToast(s, join("j4", "Bo", "🐙"), 0);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0].message).toBe("🦋 Maya and 3 others joined");
  });

  it("doesn't merge a join into the toast already on screen", () => {
    let s: ToastState = initialToastState;
    s = addToast(s, join("j1", "Maya"), 0);
    s = addToast(s, join("j2", "Sam", "🐸"), 0);
    expect(s.current?.toast.message).toBe("🦋 Maya joined");
    expect(s.queue[0].message).toBe("🐸 Sam joined");
  });

  it("ignores a toast id it already has", () => {
    let s: ToastState = initialToastState;
    s = addToast(s, t("a"), 0);
    s = addToast(s, t("a"), 1);
    expect(s.queue).toEqual([]);
  });

  it("joinMessage handles one and two", () => {
    expect(joinMessage([{ emoji: "🦋", nickname: "Maya" }])).toBe("🦋 Maya joined");
    expect(
      joinMessage([
        { emoji: "🦋", nickname: "Maya" },
        { emoji: "🐸", nickname: "Sam" },
      ]),
    ).toBe("🦋 Maya and 1 other joined");
  });
});
