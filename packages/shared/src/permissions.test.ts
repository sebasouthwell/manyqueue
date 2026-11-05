import { describe, expect, it } from "vitest";
import { hasAnyPermission, hasPermission, permissionBadge, sanitizePermissions } from "./permissions";

describe("sanitizePermissions", () => {
  it("keeps valid ones, drops junk and duplicates, uses canonical order", () => {
    expect(sanitizePermissions(["moderation", "skip", "skip", "fly", 3])).toEqual(["skip", "moderation"]);
    expect(sanitizePermissions("skip")).toEqual([]);
    expect(sanitizePermissions(undefined)).toEqual([]);
  });
});

describe("playback and volume", () => {
  it("are permissions, ordered after skip", () => {
    expect(sanitizePermissions(["volume", "playback", "skip"])).toEqual(["skip", "playback", "volume"]);
  });
  it("a co-host holds them, a plain guest doesn't", () => {
    expect(hasPermission({ role: "cohost" }, "volume")).toBe(true);
    expect(hasPermission({ role: "guest", perms: ["playback"] }, "playback")).toBe(true);
    expect(hasPermission({ role: "guest", perms: ["playback"] }, "volume")).toBe(false);
  });
});

describe("hasPermission", () => {
  it("the host and co-hosts hold everything", () => {
    expect(hasPermission({ role: "host" }, "tokens")).toBe(true);
    expect(hasPermission({ role: "cohost" }, "moderation")).toBe(true);
  });
  it("a guest holds only what they were given", () => {
    const guest = { role: "guest" as const, perms: ["skip", "approve"] as const };
    expect(hasPermission(guest, "skip")).toBe(true);
    expect(hasPermission(guest, "tokens")).toBe(false);
    expect(hasPermission({ role: "guest" }, "skip")).toBe(false);
  });
  it("hasAnyPermission", () => {
    expect(hasAnyPermission({ role: "guest", perms: ["tokens"] }, ["tokens", "moderation"])).toBe(true);
    expect(hasAnyPermission({ role: "guest", perms: ["skip"] }, ["tokens", "moderation"])).toBe(false);
  });
});

describe("permissionBadge", () => {
  it("Co-host for co-hosts, Xtra Perms for extras, nothing otherwise", () => {
    expect(permissionBadge("cohost", [])).toBe("cohost");
    expect(permissionBadge("cohost", ["skip"])).toBe("cohost");
    expect(permissionBadge("guest", ["skip"])).toBe("extra");
    expect(permissionBadge("guest", [])).toBeNull();
  });
});
