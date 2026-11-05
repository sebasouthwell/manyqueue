/** Things the host can hand to one guest without making them a co-host. */
export const PERMISSIONS = ["skip", "playback", "volume", "approve", "tokens", "moderation"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  skip: "Skip Songs",
  playback: "Pause/Play",
  volume: "Volume",
  approve: "Approve Songs",
  tokens: "Grant Tokens",
  moderation: "Moderation",
};

/** What each one actually lets them do. */
export const PERMISSION_HINTS: Record<Permission, string> = {
  skip: "Skip the playing song, remove queued songs, resync the queue",
  playback: "Pause and resume the music",
  volume: "Change the speaker volume",
  approve: "Approve or reject songs waiting for approval",
  tokens: "Grant or dock tokens (co-host hourly limit applies)",
  moderation: "Mute, rename and kick guests, hide dedications",
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Valid, unique, in the canonical order — whatever was saved or sent. */
export function sanitizePermissions(raw: unknown): Permission[] {
  const input = Array.isArray(raw) ? raw : [];
  return PERMISSIONS.filter((p) => input.includes(p));
}

interface PermissionHolder {
  role: "host" | "cohost" | "guest";
  perms?: readonly Permission[];
}

/** The host and co-hosts hold every permission; anyone else holds what they were given. */
export function hasPermission(who: PermissionHolder, perm: Permission): boolean {
  if (who.role === "host" || who.role === "cohost") return true;
  return !!who.perms?.includes(perm);
}

export function hasAnyPermission(who: PermissionHolder, perms: readonly Permission[]): boolean {
  return perms.some((p) => hasPermission(who, p));
}

/** What the People list shows next to a name: co-hosts say "Co-host" (they have
 * everything), anyone with a few extras says "Xtra Perms", everyone else nothing. */
export function permissionBadge(role: "guest" | "cohost", perms: readonly Permission[]): "cohost" | "extra" | null {
  if (role === "cohost") return "cohost";
  return perms.length > 0 ? "extra" : null;
}
