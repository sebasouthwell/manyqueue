# ManyQueue

A party jukebox for Spotify. The host logs in with Spotify Premium and picks a speaker; guests join from
their phones with a 4-letter code or QR, add songs, and vote; a TV window shows what's playing and
what's next.

## Features

- **Two queue modes**, chosen when the host starts the night (and switchable later)
  - **Shared:** one queue everyone adds to, with tokens and an optional fair order.
  - **Rotation:** everyone keeps their own queue, and songs are drafted in turn at the last moment, so
    guests can reorder until their song is picked. The host can set turn weights (boosted guests get
    their extra turns back to back or spread over the round), draft by hand, or review each draft
    before it commits. **Crowd pick** lets guests vote on everyone's top song, and **Fight for a spot**
    lets two songs battle for the next slot. The host's own songs can play next, take the next house
    pick, or be dragged to any slot in Coming up.
- **Tokens:** an optional economy for adding songs, dedications and games, with passive income.
- **Games:** song contests, skip votes, ban votes, mystery picks with "who queued this?" guesses.
- **TV display:** now playing, up next, live votes, dedications and genre-based scenes.
- **Holiday modes:** Halloween and Christmas decorations by date (or forced), seasonal touches on album
  covers (a Santa hat on Christmas songs, a witch's hat or horns on spooky ones, Cupid's bow on love
  songs in February), and a November surprise for one particular Christmas song.
- **Host desk:** speaker picker, approvals, co-hosts and permissions, kick/mute, action log, recap.
- **Reliable playback:** songs that can't play in the host's region are skipped and refunded, the same
  song under another Spotify id is recognised instead of restarted, and a stalled speaker is detected.
- **Optional AI:** party nicknames and genre tags through Claude (Anthropic) or DeepSeek; with no key the
  AI features switch themselves off.

## Stack

pnpm monorepo:

- `apps/web`: Vite, React, Tailwind, Zustand
- `apps/server`: Fastify, Socket.IO, SQLite with Drizzle
- `packages/shared`: zod schemas and the pure game and queue rules, unit-tested with Vitest

## Getting started

Requirements: Node 20+, pnpm, a Spotify Premium account and a Spotify developer app.

1. Create an app at https://developer.spotify.com/dashboard with the redirect URI
   `http://127.0.0.1:3000/auth/callback`.
2. Copy `.env.example` to `.env` and fill it in (Spotify client id and secret, `TOKEN_KEY`,
   `COOKIE_SECRET`, and `PUBLIC_URL`, the address phones use to reach the server).
3. Install, migrate and run:

   ```sh
   pnpm install
   pnpm db:migrate
   pnpm dev
   ```

4. Open `http://127.0.0.1:3000/host`, log in with Spotify, pick a speaker and open the TV window.
   Guests join at `PUBLIC_URL`.

For production without Docker: `pnpm build`, then `NODE_ENV=production pnpm --filter @manyqueue/server start`.

## Docker

```sh
docker run -d --name manyqueue -p 3000:3000 --env-file .env -v manyqueue-data:/app/data \
  ghcr.io/<owner>/<repo>:latest
```

The container applies database migrations on start and keeps the SQLite file in the `/app/data`
volume. Set `PUBLIC_URL` and `AUTH_REDIRECT_URI` in `.env` to the address guests will use.

## Tests

```sh
pnpm typecheck
pnpm test
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`): every push to `main` and every pull request type-checks, runs the
  tests, builds the app and checks that the Docker image builds.
- **Release** (`.github/workflows/release.yml`): pushing a version tag (`git tag v1.0.0 && git push
  origin v1.0.0`) runs CI, publishes a multi-arch image (amd64 and arm64) to the GitHub Container
  Registry, and creates a GitHub Release with generated notes.
- **Dependabot** opens weekly dependency updates.
