import type { FastifyRequest } from "fastify";
import { hasAnyPermission, type ActorRole, type Permission } from "@manyqueue/shared";
import { getHostById, type Host } from "./db/hosts.js";
import { getGuestById, type Guest } from "./db/guests.js";
import type { Room } from "./db/rooms.js";

export function getAuthenticatedHost(req: FastifyRequest): Host | null {
  const raw = req.cookies.host_session;
  if (!raw) return null;

  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;

  return getHostById(unsigned.value) ?? null;
}

export function getAuthenticatedGuestId(req: FastifyRequest): string | null {
  const raw = req.cookies.guest_session;
  if (!raw) return null;

  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

/**
 * The guest making this request, only if they're still a live member of this room. A kicked guest's
 * signed cookie is still cryptographically valid — being kicked has to be checked, not just "is this
 * cookie real" — so every route that acts on a guest's own behalf should read through this (or
 * getActorRole below, which applies the same check) rather than calling getAuthenticatedGuestId directly.
 */
export function getActiveGuest(req: FastifyRequest, room: Room): Guest | null {
  const guestId = getAuthenticatedGuestId(req);
  if (!guestId) return null;
  const guest = getGuestById(guestId);
  if (!guest || guest.roomId !== room.id || guest.kickedAt) return null;
  return guest;
}

export interface Actor {
  role: ActorRole;
  hostId?: string;
  guestId?: string;
  /** A guest's extra permissions (co-hosts and the host hold all of them anyway). */
  perms?: Permission[];
}

/** Who's making this request, and what role they have in this specific room —
 * the host always resolves to "host" regardless of guest state. */
export function getActorRole(req: FastifyRequest, room: Room): Actor | null {
  const host = getAuthenticatedHost(req);
  if (host && host.id === room.hostId) return { role: "host", hostId: host.id };

  const guestId = getAuthenticatedGuestId(req);
  if (guestId) {
    const guest = getGuestById(guestId);
    // A kicked guest's cookie is still valid — without this check they'd keep every permission they had
    // (including full co-host power) forever, just by holding onto it. Being removed from the room has
    // to actually remove their access.
    if (guest && guest.roomId === room.id && !guest.kickedAt) {
      return { role: guest.role === "cohost" ? "cohost" : "guest", guestId, perms: guest.perms ?? [] };
    }
  }

  return null;
}

/** The one role check used everywhere — host passes every check; a cohost only
 * passes when minRole is "cohost". Returns the actor (so callers can log who did
 * it) or null if the request doesn't meet the bar. */
export function requireRole(
  req: FastifyRequest,
  room: Room,
  minRole: "cohost" | "host",
): Actor | null {
  const actor = getActorRole(req, room);
  if (!actor) return null;
  if (actor.role === "host") return actor;
  if (minRole === "cohost" && actor.role === "cohost") return actor;
  return null;
}

/** Passes when the actor holds any of the given permissions: the host and
 * co-hosts always do, other guests only if the host gave them that one. */
export function requirePerm(req: FastifyRequest, room: Room, ...perms: Permission[]): Actor | null {
  const actor = getActorRole(req, room);
  if (!actor) return null;
  return hasAnyPermission(actor, perms) ? actor : null;
}

/** Host, co-hosts, and anyone holding at least one permission — who may see the activity log. */
export function requireStaff(req: FastifyRequest, room: Room): Actor | null {
  const actor = getActorRole(req, room);
  if (!actor) return null;
  // The secret glitch grant doesn't make anyone staff.
  if (actor.role !== "guest" || (actor.perms ?? []).some((p) => p !== "glitch")) return actor;
  return null;
}
