# ManyQueue

A party jukebox for Spotify. The host logs in with Spotify Premium and picks a speaker; guests join from
their phones with a 4-letter code or QR, add songs, and vote; a TV window shows what's playing and
what's next.

## Features

- **Two queue modes**
  - **Shared:** one queue everyone adds to, with tokens and an optional fair order.
  - **Rotation:** everyone keeps their own queue, and songs are drafted in turn at the last moment, so
    guests can reorder until their song is picked. The host can set turn weights, draft by hand, or
    review each draft before it commits. **Crowd pick** lets guests vote on everyone's top song.
- **Tokens:** an optional economy for adding songs, dedications and games, with passive income.
- **Games:** song contests, skip votes, ban votes, mystery picks with "who queued this?" guesses.
- **TV display:** now playing, up next, live votes, dedications and genre-based scenes.
- **Host desk:** speaker picker, approvals, co-hosts and permissions, kick/mute, action log, recap.
- **Optional AI:** party nicknames and genre tags through an OpenAI-compatible API (DeepSeek by default).

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

For production: `pnpm build`, then run `apps/server` with `NODE_ENV=production`.

## Tests

```sh
pnpm --filter @manyqueue/shared test
pnpm --filter @manyqueue/server test
```
