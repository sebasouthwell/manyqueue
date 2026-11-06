import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { HOST_NOTE_MAX, SOCKET_EVENTS, type GlitchPayload } from "@manyqueue/shared";
import { getIO } from "../realtime/io-instance.js";
import { emitToGuest } from "../realtime/socket-server.js";
import { getRoomByCode } from "../db/rooms.js";
import { getGuestById } from "../db/guests.js";
import { getActiveGuest, getAuthenticatedHost, requirePerm } from "../auth-helpers.js";
import { finishGlitch, glitchStateOf, setGlitch, startArmedGlitch } from "../db/glitch.js";
import { db } from "../db/client.js";
import { guests } from "../db/schema.js";

/**
 * A little secret: the host leaves a guest a private note, and the guest sees it the next time they use
 * the app (the guest app checks when they switch tabs). Nobody else ever sees it, it isn't in the action
 * log, and it's gone once read.
 */
export const hostNoteRoutes: FastifyPluginAsync = async (app) => {
  // Host only: set, replace or clear (empty message) the note for one guest.
  app.put<{ Params: { code: string; guestId: string }; Body: { message?: unknown } }>(
    "/rooms/:code/guests/:guestId/note",
    async (req, reply) => {
      const host = getAuthenticatedHost(req);
      if (!host) return reply.code(401).send({ error: "not_logged_in" });
      const room = getRoomByCode(req.params.code);
      if (!room || room.hostId !== host.id) return reply.code(404).send({ error: "room_not_found" });
      const guest = getGuestById(req.params.guestId);
      if (!guest || guest.roomId !== room.id || guest.kickedAt) return reply.code(404).send({ error: "guest_not_found" });
      if (req.body?.message !== undefined && typeof req.body.message !== "string") return reply.code(400).send({ error: "invalid_message" });
      const message = ((req.body?.message as string | undefined) ?? "").trim().slice(0, HOST_NOTE_MAX);
      db.update(guests).set({ hostNote: message || null }).where(eq(guests.id, guest.id)).run();
      return { hostNote: message || null };
    },
  );

  // ---- Glitch mode easter egg ----
  // The host, or anyone the host granted the secret glitch permission (co-hosts don't get it by default).
  // Not logged.
  app.put<{ Params: { code: string; guestId: string }; Body: { level?: unknown; durationSec?: unknown; nextVisit?: unknown } }>(
    "/rooms/:code/guests/:guestId/glitch",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const actor = requirePerm(req, room, "glitch");
      if (!actor) return reply.code(403).send({ error: "not_allowed" });
      const guest = getGuestById(req.params.guestId);
      if (!guest || guest.roomId !== room.id || guest.kickedAt) return reply.code(404).send({ error: "guest_not_found" });
      const { level, durationSec, nextVisit } = req.body ?? {};
      if (typeof level !== "number" || !Number.isFinite(level)) return reply.code(400).send({ error: "invalid_level" });
      if (durationSec !== null && durationSec !== undefined && (typeof durationSec !== "number" || !Number.isFinite(durationSec))) {
        return reply.code(400).send({ error: "invalid_duration" });
      }
      const state = setGlitch(guest.id, { level, durationSec: (durationSec as number | null | undefined) ?? null, nextVisit: nextVisit === true });
      emitToGuest(getIO(), room.code, guest.id, SOCKET_EVENTS.GLITCH_UPDATE, state satisfies GlitchPayload);
      return state;
    },
  );

  app.get<{ Params: { code: string } }>("/rooms/:code/me/glitch", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    return glitchStateOf(guest);
  });

  // The guest's phone: the armed glitch starts now / the timed one has finished.
  for (const step of ["start", "done"] as const) {
    app.post<{ Params: { code: string } }>(`/rooms/:code/me/glitch/${step}`, async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const guest = getActiveGuest(req, room);
      if (!guest) return reply.code(401).send({ error: "not_joined" });
      return step === "start" ? startArmedGlitch(guest.id) : finishGlitch(guest.id);
    });
  }

  // The guest's own pending note, if any.
  app.get<{ Params: { code: string } }>("/rooms/:code/me/note", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    return { note: guest.hostNote ?? null };
  });

  // Read: clear it, but only if it's still the note they saw (the host may have just written a new one).
  app.post<{ Params: { code: string }; Body: { note?: unknown } }>("/rooms/:code/me/note/seen", async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const guest = getActiveGuest(req, room);
    if (!guest) return reply.code(401).send({ error: "not_joined" });
    if (typeof req.body?.note !== "string") return reply.code(400).send({ error: "invalid_note" });
    db.update(guests)
      .set({ hostNote: null })
      .where(and(eq(guests.id, guest.id), eq(guests.hostNote, req.body.note)))
      .run();
    return { ok: true };
  });
};
