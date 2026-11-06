/** Things the host can hand to one guest without making them a co-host. */
export const PERMISSIONS = ["skip", "playback", "volume", "approve", "tokens", "moderation"] as const;
/** Glitch mode's secret permission: only shown once the host unlocks glitch mode, and never included
 * with co-host (the host grants it to whoever they like, co-hosts too, one by one). */
export const GLITCH_PERMISSION = "glitch" as const;
export const ALL_PERMISSIONS = [...PERMISSIONS, GLITCH_PERMISSION] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  skip: "Skip Songs",
  playback: "Pause/Play",
  volume: "Volume",
  approve: "Approve Songs",
  tokens: "Grant Tokens",
  moderation: "Moderation",
  glitch: "🌀 Glitch",
};

/** What each one actually lets them do. */
export const PERMISSION_HINTS: Record<Permission, string> = {
  skip: "Skip the playing song, remove queued songs, resync the queue",
  playback: "Pause and resume the music",
  volume: "Change the speaker volume",
  approve: "Approve or reject songs waiting for approval",
  tokens: "Grant or dock tokens (co-host hourly limit applies)",
  moderation: "Mute, rename and kick guests, hide dedications",
  glitch: "Glitch other people's apps (glitch mode)",
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/** Valid, unique, in the canonical order — whatever was saved or sent. */
export function sanitizePermissions(raw: unknown): Permission[] {
  const input = Array.isArray(raw) ? raw : [];
  return ALL_PERMISSIONS.filter((p) => input.includes(p));
}

interface PermissionHolder {
  role: "host" | "cohost" | "guest";
  perms?: readonly Permission[];
}

/** The host and co-hosts hold every permission; anyone else holds what they were given. */
export function hasPermission(who: PermissionHolder, perm: Permission): boolean {
  if (who.role === "host") return true;
  // Glitch is never part of co-host: only an explicit grant counts.
  if (perm === GLITCH_PERMISSION) return !!who.perms?.includes(perm);
  if (who.role === "cohost") return true;
  return !!who.perms?.includes(perm);
}

export function hasAnyPermission(who: PermissionHolder, perms: readonly Permission[]): boolean {
  return perms.some((p) => hasPermission(who, p));
}

/** What the People list shows next to a name: co-hosts say "Co-host" (they have
 * everything), anyone with a few extras says "Xtra Perms", everyone else nothing. */
export function permissionBadge(role: "guest" | "cohost", perms: readonly Permission[]): "cohost" | "extra" | null {
  if (role === "cohost") return "cohost";
  return perms.some((p) => p !== GLITCH_PERMISSION) ? "extra" : null; // the glitch grant stays secret
}
