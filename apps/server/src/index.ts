import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHttpProxy from "@fastify/http-proxy";
import fastifyCookie from "@fastify/cookie";
import { Server as SocketIOServer } from "socket.io";
import { authRoutes } from "./routes/auth.js";
import { roomRoutes } from "./routes/rooms.js";
import { guestRoutes } from "./routes/guests.js";
import { searchRoutes } from "./routes/search.js";
import { queueRoutes } from "./routes/queue.js";
import { rotationRoutes } from "./routes/rotation.js";
import { voteRoutes } from "./routes/votes.js";
import { voteBallotRoutes } from "./routes/vote-ballots.js";
import { contestRoutes } from "./routes/contest.js";
import { banRoutes } from "./routes/ban.js";
import { gamesRoutes } from "./routes/games.js";
import { hostControlRoutes } from "./routes/host-controls.js";
import { settingsRoutes } from "./routes/settings.js";
import { roleRoutes } from "./routes/roles.js";
import { hostNoteRoutes } from "./routes/host-notes.js";
import { peopleLockRoutes } from "./routes/people-lock.js";
import { aiNicknameRoutes } from "./routes/ai-nicknames.js";
import { recapRoutes } from "./routes/recap.js";
import { initAiNicknames } from "./realtime/ai-nicknames.js";
import { setAiLogger } from "./ai/provider.js";
import { moderationRoutes } from "./routes/moderation.js";
import { resyncRoutes } from "./routes/resync.js";
import { setupSocketServer } from "./realtime/socket-server.js";
import { setIO } from "./realtime/io-instance.js";
import { startPlayerLoop } from "./realtime/player-loop.js";
import { initVotes } from "./realtime/votes.js";
import { initContests } from "./realtime/contest.js";
import { initBans } from "./realtime/ban.js";
import { initGuess } from "./realtime/guess.js";
import { initGames } from "./realtime/games.js";
import { registerMomentHooks } from "./realtime/moments.js";
import { getAllActiveRoomsWithDevice } from "./db/rooms.js";
import { onSpotifyStatusChange, initSpotifyCredentials } from "./spotify.js";
import { anyHostHasBackupLogin } from "./db/hosts.js";
import { SOCKET_EVENTS } from "@manyqueue/shared";
import { primeFallbackPlaylist } from "./fallback-playlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

// trustProxy: the app usually sits behind a proxy (a reverse proxy, a CDN or a tunnel). Without it,
// req.ip is always the proxy's own address: every guest looks identical, IP-based device blocking blocks
// nobody in particular, and once one guest's "IP" is blocked, every future guest matches it too.
//
// A hop count, not `true`: `true` takes the leftmost X-Forwarded-For entry, which is whatever the client
// sent (proxies append to it, they don't replace it), so anyone could pick their own "IP" and walk past
// kick blocks and the join limit. Set TRUST_PROXY_HOPS to the number of proxies in front (default 2,
// e.g. a CDN in front of a reverse proxy). With fewer in front, it degrades safely.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 2);
// A function, not the number: this Fastify version's types don't take a hop count. Index 0 is the
// socket peer, 1 the address it saw, and so on back to the client.
const app = Fastify({ logger: true, trustProxy: (_addr: string, hop: number) => hop < TRUST_PROXY_HOPS });

// Signs host/guest session cookies and recap links: never run without it (no weak fallback).
if (!process.env.COOKIE_SECRET) {
  throw new Error("COOKIE_SECRET is not set: generate one (see .env.example) before starting the server");
}

await app.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET,
});

app.get("/healthz", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(roomRoutes);
await app.register(guestRoutes);
await app.register(searchRoutes);
await app.register(queueRoutes);
await app.register(rotationRoutes);
await app.register(voteRoutes);
await app.register(voteBallotRoutes);
await app.register(contestRoutes);
await app.register(banRoutes);
await app.register(gamesRoutes);
await app.register(hostControlRoutes);
await app.register(settingsRoutes);
await app.register(roleRoutes);
await app.register(hostNoteRoutes);
await app.register(peopleLockRoutes);
await app.register(aiNicknameRoutes);
await app.register(recapRoutes);
await app.register(moderationRoutes);
await app.register(resyncRoutes);

if (isProd) {
  const webDist = path.resolve(__dirname, "../../web/dist");
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/healthz")) {
      reply.sendFile("index.html");
    } else {
      reply.code(404).send({ error: "not_found" });
    }
  });
} else {
  // websocket: false — @fastify/http-proxy's WS forwarding (for Vite HMR) proxies
  // every upgrade request with no path filtering, including /socket.io/*, racing
  // Engine.IO's own upgrade listener for the same handshake ("handleUpgrade()
  // called more than once with the same socket"). Trading away Vite's HMR
  // auto-refresh in dev for working Socket.IO; production serves the built SPA
  // directly with no proxy, so this doesn't affect production at all.
  await app.register(fastifyHttpProxy, {
    upstream: "http://127.0.0.1:5173",
    prefix: "/",
    websocket: false,
  });

  // Vite's hot-reload socket, without the conflict: tunnel every websocket upgrade
  // that isn't Socket.IO straight to Vite, so open tabs (phones included) pick up
  // code changes by themselves and reload when the dev server restarts.
  app.server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/socket.io/")) return;
    const upstream = net.connect(5173, "127.0.0.1", () => {
      const headers = req.rawHeaders.reduce((out: string, v: string, i: number) => (i % 2 === 0 ? `${out}${v}: ` : `${out}${v}\r\n`), "");
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
}

const io = new SocketIOServer(app.server, { path: "/socket.io/" });
setIO(io);
setupSocketServer(io);
// Tell every client when Spotify starts or stops rate-limiting the app (or a login needs redoing).
initSpotifyCredentials(anyHostHasBackupLogin());
onSpotifyStatusChange((status) => io.emit(SOCKET_EVENTS.SPOTIFY_STATUS, status));
registerMomentHooks(() => io);
setAiLogger(app.log);
initAiNicknames(io);

await app.listen({ port: PORT, host: HOST });
initContests();
initBans();
initGuess();
initGames();
const rearmedVotes = initVotes();
if (rearmedVotes > 0) app.log.info(`Re-armed ${rearmedVotes} open vote(s)`);
app.log.info(`ManyQueue server listening on http://${HOST}:${PORT}`);

for (const room of getAllActiveRoomsWithDevice()) {
  if (room.deviceId && room.deviceName) {
    startPlayerLoop(room.code, room.deviceId, room.deviceName);
    app.log.info(`Resumed player loop for room ${room.code} (${room.deviceName})`);
  }
  if (room.fallbackPlaylistUri) {
    const playlistId = room.fallbackPlaylistUri.replace("spotify:playlist:", "");
    primeFallbackPlaylist(room.hostId, playlistId)
      .then((count) => app.log.info(`Reloaded fallback playlist for room ${room.code} (${count} tracks)`))
      .catch((err) => app.log.error(err, `failed to reload fallback playlist for room ${room.code}`));
  }
}
