import type { FastifyPluginAsync } from "fastify";
import { LRUCache } from "lru-cache";
import { queueAddPrice, songRuleViolation, type SearchResponse, type TrackResult } from "@manyqueue/shared";
import { getRoomByCode } from "../db/rooms.js";
import { getRoomSettings } from "../db/settings.js";
import { listBannedUris } from "../db/bans.js";
import { countPlaysTonight } from "../db/queue.js";
import { searchTracks, SpotifyQuotaError } from "../spotify.js";
import { getActiveGuest, getAuthenticatedHost } from "../auth-helpers.js";

interface CachedSearch {
  tracks: TrackResult[];
  total: number;
}

// Only the raw track metadata is cached — price depends on room-specific play
// history and must be computed fresh on every request, never cached.
const searchCache = new LRUCache<string, CachedSearch>({
  max: 500,
  ttl: 10 * 60 * 1000,
});

const RATE_LIMIT_MS = 1000;
const lastRequestAt = new Map<string, number>();

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { code: string }; Querystring: { q?: string; offset?: string } }>(
    "/rooms/:code/search",
    async (req, reply) => {
      const room = getRoomByCode(req.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });

      // Search spends the room's shared Spotify quota — without this, anyone who knows (or guesses) a
      // 4-letter room code could flood it without ever joining, and burn the whole developer account's
      // quota (it's shared across every room, per Spotify's July 2026 change).
      const guest = getActiveGuest(req, room);
      const host = getAuthenticatedHost(req);
      if (!guest && !(host && host.id === room.hostId)) return reply.code(401).send({ error: "not_joined" });

      const requesterId = req.cookies.guest_session ?? req.cookies.host_session ?? req.ip;
      const now = Date.now();
      const last = lastRequestAt.get(requesterId);
      if (last && now - last < RATE_LIMIT_MS) {
        return reply.code(429).send({ error: "rate_limited" });
      }
      lastRequestAt.set(requesterId, now);

      const q = (req.query.q ?? "").trim();
      const offset = Number(req.query.offset ?? "0") || 0;

      if (q.length < 2) {
        return { tracks: [], offset, limit: 10, total: 0 } satisfies SearchResponse;
      }

      const roomId = room.id;
      const settings = getRoomSettings(roomId);

      function priceResults(cached: CachedSearch): SearchResponse {
        const bannedUris = listBannedUris(roomId);
        const tracks = cached.tracks.map((track) => {
          const playsTonight = countPlaysTonight(roomId, track.uri);
          return {
            ...track,
            // Rotation mode: adding is always free — the real price is settled at draft time (D2).
            price: settings.mode === "rotation" ? 0 : queueAddPrice(settings, playsTonight),
            playsTonight,
            rule: songRuleViolation(track, settings),
            banned: bannedUris.has(track.uri),
          };
        });
        return { tracks, offset, limit: 10, total: cached.total };
      }

      const cacheKey = `${room.hostId}:${q.toLowerCase()}:${offset}`;
      const cached = searchCache.get(cacheKey);
      if (cached) {
        req.log.info({ cacheKey }, "search cache hit");
        return priceResults(cached);
      }

      try {
        const { tracks, total } = await searchTracks(room.hostId, q, offset, 10);
        const cacheEntry: CachedSearch = { tracks, total };
        searchCache.set(cacheKey, cacheEntry);
        req.log.info({ cacheKey }, "search cache miss — fetched from Spotify");
        return priceResults(cacheEntry);
      } catch (err) {
        if (err instanceof SpotifyQuotaError) {
          return reply.code(503).send({ error: "quota_exceeded", retryAfterSec: err.retryAfterSec });
        }
        req.log.error(err, "search failed");
        return reply.code(502).send({ error: "search_failed" });
      }
    },
  );
};
