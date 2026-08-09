# Debian rather than Alpine: better-sqlite3 ships glibc prebuilds, so this
# avoids pulling a full C++ toolchain in just to compile the binding.
FROM node:22-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod


FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Mount a volume here, or the link table is lost on every redeploy and the
# next sync duplicates every event. See `pnpm rebuild-links` if that happens.
ENV DATABASE_PATH=/data/sync.db
VOLUME ["/data"]

EXPOSE 3000
USER node

CMD ["node", "dist/index.js"]
