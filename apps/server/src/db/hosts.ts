import crypto from "node:crypto";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "./client.js";
import { hosts } from "./schema.js";
import { encrypt, decrypt } from "../crypto.js";

export type Host = typeof hosts.$inferSelect;

export function getHostById(id: string): Host | undefined {
  return db.select().from(hosts).where(eq(hosts.id, id)).get();
}

export function getHostBySpotifyUserId(spotifyUserId: string): Host | undefined {
  return db.select().from(hosts).where(eq(hosts.spotifyUserId, spotifyUserId)).get();
}

export type CredentialSlot = "primary" | "backup";

/** The saved login for one Spotify app, or null if the host never logged in through it. */
export function getDecryptedRefreshToken(host: Host, slot: CredentialSlot = "primary"): string | null {
  if (slot === "backup") {
    if (!host.backupRefreshTokenEnc || !host.backupTokenIv) return null;
    return decrypt(host.backupRefreshTokenEnc, host.backupTokenIv);
  }
  return decrypt(host.refreshTokenEnc, host.tokenIv);
}

export function upsertHost(params: {
  spotifyUserId: string;
  displayName: string;
  refreshToken: string;
}): Host {
  const existing = getHostBySpotifyUserId(params.spotifyUserId);
  const { enc, iv } = encrypt(params.refreshToken);

  if (existing) {
    db.update(hosts)
      .set({ displayName: params.displayName, refreshTokenEnc: enc, tokenIv: iv })
      .where(eq(hosts.id, existing.id))
      .run();
    return { ...existing, displayName: params.displayName, refreshTokenEnc: enc, tokenIv: iv };
  }

  const id = crypto.randomUUID();
  const host: Host = {
    id,
    spotifyUserId: params.spotifyUserId,
    displayName: params.displayName,
    refreshTokenEnc: enc,
    tokenIv: iv,
    backupRefreshTokenEnc: null,
    backupTokenIv: null,
    peoplePinHash: null,
    peoplePinSalt: null,
    createdAt: new Date(),
  };
  db.insert(hosts).values(host).run();
  return host;
}

export function updateRefreshToken(hostId: string, refreshToken: string, slot: CredentialSlot = "primary"): void {
  const { enc, iv } = encrypt(refreshToken);
  const set =
    slot === "backup"
      ? { backupRefreshTokenEnc: enc, backupTokenIv: iv }
      : { refreshTokenEnc: enc, tokenIv: iv };
  db.update(hosts).set(set).where(eq(hosts.id, hostId)).run();
}

/** Has any host logged in through the backup Spotify app? */
export function anyHostHasBackupLogin(): boolean {
  return db.select({ id: hosts.id }).from(hosts).where(isNotNull(hosts.backupRefreshTokenEnc)).limit(1).all().length > 0;
}

// ---- People-section PIN lock: a screen lock, not a real auth boundary (the host_session cookie
// already grants full power) — scrypt-hashed so it's never stored or logged in plain. ----

const SCRYPT_KEYLEN = 32;

function hashPin(pin: string, salt: Buffer): Buffer {
  return crypto.scryptSync(pin, salt, SCRYPT_KEYLEN);
}

export function hostHasPeoplePin(hostId: string): boolean {
  const host = getHostById(hostId);
  return !!host?.peoplePinHash;
}

/** Sets, changes, or (pin: null) clears the host's People-lock PIN. */
export function setPeoplePin(hostId: string, pin: string | null): void {
  if (pin === null) {
    db.update(hosts).set({ peoplePinHash: null, peoplePinSalt: null }).where(eq(hosts.id, hostId)).run();
    return;
  }
  const salt = crypto.randomBytes(16);
  const hash = hashPin(pin, salt);
  db.update(hosts)
    .set({ peoplePinHash: hash.toString("hex"), peoplePinSalt: salt.toString("hex") })
    .where(eq(hosts.id, hostId))
    .run();
}

export function verifyPeoplePin(hostId: string, pin: string): boolean {
  const host = getHostById(hostId);
  if (!host?.peoplePinHash || !host.peoplePinSalt) return false;
  const salt = Buffer.from(host.peoplePinSalt, "hex");
  const expected = Buffer.from(host.peoplePinHash, "hex");
  const given = hashPin(pin, salt);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
