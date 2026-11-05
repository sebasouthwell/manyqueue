import { describe, it, expect } from "vitest";
import { RoomSettingsSchema, DEFAULT_ROOM_SETTINGS, RoomSettingsPatchSchema } from "./room-settings.js";

describe("room mode", () => {
  it("defaults to shared", () => {
    expect(DEFAULT_ROOM_SETTINGS.mode).toBe("shared");
  });

  it("accepts a rotation switch via patch", () => {
    const patch = RoomSettingsPatchSchema.parse({ mode: "rotation" });
    expect(patch.mode).toBe("rotation");
  });

  it("rejects an unknown mode", () => {
    expect(() => RoomSettingsSchema.parse({ mode: "chaos" })).toThrow();
  });
});
