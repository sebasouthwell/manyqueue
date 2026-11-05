import type { FastifyPluginAsync } from "fastify";
import {
  buildAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  exchangeCodeForToken,
  resetSpotifyAuthFailure,
  fetchProfile,
  isBackupConfigured,
  type CredentialSlot,
} from "../spotify.js";
import { upsertHost, getHostBySpotifyUserId, updateRefreshToken } from "../db/hosts.js";
import { getAuthenticatedHost } from "../auth-helpers.js";

const PKCE_TTL_MS = 10 * 60 * 1000;
const pkceStore = new Map<string, { codeVerifier: string; createdAt: number; slot: CredentialSlot }>();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of pkceStore) {
    if (now - entry.createdAt > PKCE_TTL_MS) pkceStore.delete(state);
  }
}

function redirectUri(): string {
  return process.env.AUTH_REDIRECT_URI ?? `http://127.0.0.1:${process.env.PORT ?? 3000}/auth/callback`;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // /auth/login logs in through the main Spotify app; /auth/login?slot=backup through the backup app
  // (a second developer account's app, used when the main one is rate-limited).
  app.get<{ Querystring: { slot?: string } }>("/auth/login", async (req, reply) => {
    const slot: CredentialSlot = req.query.slot === "backup" ? "backup" : "primary";
    if (slot === "backup" && !isBackupConfigured()) return reply.redirect(`/host?auth=backup_not_configured`);
    cleanupExpiredStates();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    pkceStore.set(state, { codeVerifier, createdAt: Date.now(), slot });

    const url = buildAuthorizeUrl({ redirectUri: redirectUri(), state, codeChallenge, slot });
    reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;

      if (error) {
        return reply.redirect(`/host?auth=error`);
      }
      if (!code || !state) {
        return reply.code(400).send({ error: "missing_code_or_state" });
      }

      const pending = pkceStore.get(state);
      if (!pending) {
        return reply.code(400).send({ error: "invalid_or_expired_state" });
      }
      pkceStore.delete(state);

      try {
        const tokenRes = await exchangeCodeForToken({
          code,
          redirectUri: redirectUri(),
          codeVerifier: pending.codeVerifier,
          slot: pending.slot,
        });

        const profile = await fetchProfile(tokenRes.access_token);

        if (pending.slot === "backup") {
          // The backup login must belong to the same Spotify account that already hosts here: the
          // speakers and playback belong to that account, the backup app only supplies more quota.
          const existing = getHostBySpotifyUserId(profile.id);
          if (!existing || !tokenRes.refresh_token) return reply.redirect(`/host?auth=backup_wrong_account`);
          updateRefreshToken(existing.id, tokenRes.refresh_token, "backup");
          resetSpotifyAuthFailure("backup");
          return reply.redirect("/host?auth=backup_ok");
        }

        if (profile.product !== "premium") {
          return reply.redirect(`/host?auth=premium_required`);
        }

        const host = upsertHost({
          spotifyUserId: profile.id,
          displayName: profile.display_name ?? profile.id,
          refreshToken: tokenRes.refresh_token ?? "",
        });

        resetSpotifyAuthFailure(); // fresh tokens: stop refusing to try

        reply.setCookie("host_session", host.id, {
          httpOnly: true,
          signed: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
        });

        return reply.redirect("/host");
      } catch (err) {
        app.log.error(err);
        return reply.redirect(`/host?auth=error`);
      }
    },
  );

  app.get("/auth/me", async (req, reply) => {
    const host = getAuthenticatedHost(req);
    if (!host) return reply.code(401).send({ error: "not_logged_in" });
    return { host: { id: host.id, displayName: host.displayName } };
  });
};
