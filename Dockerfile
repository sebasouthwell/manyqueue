# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
# Toolchain only in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p data && chown -R node:node data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @manyqueue/server start"]
