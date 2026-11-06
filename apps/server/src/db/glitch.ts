import { eq } from "drizzle-orm";
import type { GlitchState } from "@manyqueue/shared";
import { db as defaultDb, type DB } from "./client.js";
import { guests } from "./schema.js";
import type { Guest } from "./guests.js";

const getGuestById = (id: string, database: DB) => database.select().from(guests).where(eq(guests.id, id)).get();

/** Glitch mode easter egg: a guest's glitch as stored. A timed glitch whose time has run out reads as
 * off (and is written back as off the next time it's touched). */
export function glitchStateOf(g: Guest, now = Date.now()): GlitchState {
  const startedAt = g.glitchStartedAt ? g.glitchStartedAt.getTime() : null;
  const expired = g.glitchLevel > 0 && !g.glitchArmed && g.glitchDurationSec !== null && startedAt !== null && now > startedAt + g.glitchDurationSec * 1000;
  if (g.glitchLevel <= 0 || expired) return { level: 0, durationSec: g.glitchDurationSec, armed: false, startedAt: null };
  return { level: g.glitchLevel, durationSec: g.glitchDurationSec, armed: g.glitchArmed, startedAt };
}

/** Set (or stop, with level 0) a guest's glitch. `nextVisit`: wait for them to open the app or switch
 * screens, then start 3-7s later; otherwise it starts now. */
export function setGlitch(
  guestId: string,
  params: { level: number; durationSec: number | null; nextVisit: boolean },
  database: DB = defaultDb,
): GlitchState {
  const level = Math.max(0, Math.min(100, Math.round(params.level)));
  const durationSec = params.durationSec === null ? null : Math.max(5, Math.min(3600, Math.round(params.durationSec)));
  database
    .update(guests)
    .set(
      level === 0
        ? { glitchLevel: 0, glitchArmed: false, glitchStartedAt: null }
        : { glitchLevel: level, glitchDurationSec: durationSec, glitchArmed: params.nextVisit, glitchStartedAt: params.nextVisit ? null : new Date() },
    )
    .where(eq(guests.id, guestId))
    .run();
  return glitchStateOf(getGuestById(guestId, database)!);
}

/** The guest's phone reached the moment: an armed glitch starts now. */
export function startArmedGlitch(guestId: string, database: DB = defaultDb): GlitchState {
  const g = getGuestById(guestId, database);
  if (!g) return { level: 0, durationSec: null, armed: false, startedAt: null };
  if (g.glitchLevel > 0 && g.glitchArmed) {
    database.update(guests).set({ glitchArmed: false, glitchStartedAt: new Date() }).where(eq(guests.id, guestId)).run();
  }
  return glitchStateOf(getGuestById(guestId, database)!);
}

/** A timed glitch has run its course: switch it off for good (the host's modal then shows "Off"). */
export function finishGlitch(guestId: string, database: DB = defaultDb): GlitchState {
  const g = getGuestById(guestId, database);
  if (g && glitchStateOf(g, Date.now() + 2_000).level === 0 && g.glitchLevel > 0) {
    database.update(guests).set({ glitchLevel: 0, glitchArmed: false, glitchStartedAt: null }).where(eq(guests.id, guestId)).run();
  }
  return glitchStateOf(getGuestById(guestId, database)!);
}
