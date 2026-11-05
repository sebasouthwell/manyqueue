import type { FastifyPluginAsync } from "fastify";
import { getAuthenticatedHost } from "../auth-helpers.js";
import { getRoomByCode } from "../db/rooms.js";
import { hostHasPeoplePin, setPeoplePin, verifyPeoplePin } from "../db/hosts.js";

/**
 * A PIN lock for the host desk's People section — not a real auth boundary (the host_session cookie
 * already grants full power), a screen lock against someone at an unattended, already-logged-in host
 * laptop handing themselves co-host. Unset by default; the client re-locks on every page load.
 */
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attemptsByHost = new Map<string, number[]>();

function attemptsAllowed(hostId: string): boolean {
  const now = Date.now();
  const recent = (attemptsByHost.get(hostId) ?? []).filter((at) => now - at < ATTEMPT_WINDOW_MS);
  attemptsByHost.set(hostId, recent);
  if (recent.length >= MAX_ATTEMPTS) return false;
  recent.push(now);
  return true;
}

export const peopleLockRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string } }>("/rooms/:code/people-lock", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });
    const room = getRoomByCode(req.params.code);
    if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });
    return { set: hostHasPeoplePin(host.id) };
  });

  app.post<{ Params: { code: string }; Body: { pin?: string | null } }>(
    "/rooms/:code/people-lock",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });
      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      const pin = req.body?.pin;
      if (pin === null || pin === undefined) {
        setPeoplePin(host.id, null);
        return { ok: true, set: false };
      }
      if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) {
        return reply.code(400).send({ error: "invalid_pin" });
      }
      setPeoplePin(host.id, pin);
      return { ok: true, set: true };
    },
  );

  app.post<{ Params: { code: string }; Body: { pin?: string } }>(
    "/rooms/:code/people-lock/verify",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });
      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });

      if (!attemptsAllowed(host.id)) return reply.code(429).send({ error: "too_many_attempts" });

      const pin = req.body?.pin;
      if (typeof pin !== "string") return reply.code(400).send({ error: "invalid_pin" });
      return { ok: verifyPeoplePin(host.id, pin) };
    },
  );
};
