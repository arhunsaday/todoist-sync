# Debian rather than Alpine: better-sqlite3 ships glibc prebuilds, so this
# avoids pulling a full C++ toolchain in just to compile the binding.
FROM node:22-slim AS build

WORKDIR /app
RUN corepack enable

# better-sqlite3 does not always find a matching prebuild for the image's exact
# Node ABI and falls back to node-gyp, which needs a toolchain. Installing it
# here rather than hoping for a prebuild makes the build deterministic; none of
# this reaches the runtime stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
# Compiles the server and builds the UI into dist/public; the UI's toolchain
# is dev-only and pruned right after.
RUN pnpm build && pnpm prune --prod


FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Attach persistent storage at /data, or the link table is lost on every
# redeploy and the next sync duplicates every event (`pnpm rebuild-links`
# recovers from that). Deliberately no VOLUME instruction: Railway rejects it,
# and the mount is the platform's job either way — `docker run -v`, a compose
# volume, or a Railway volume mounted at /data.
ENV DATABASE_PATH=/data/sync.db
RUN mkdir -p /data && chown node:node /data

# The container intentionally starts as root and the entrypoint drops to
# `node`. Volumes are mounted root-owned *after* the image is built, so a
# `USER node` here could never write to one — the ownership fix has to happen
# at run time, which is what the entrypoint does.
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 3000

CMD ["node", "dist/index.js"]
