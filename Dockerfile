FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 PERLA_SQLITE_PATH=/app/data/perla.sqlite
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/scripts/start-vps.mjs /app/scripts/migrate-vps.mjs /app/scripts/backup-vps.mjs ./scripts/
COPY --from=build --chown=node:node /app/scripts/reward-settle.bundle.mjs ./scripts/
COPY --from=build --chown=node:node /app/lib/vps/sqlite.mjs ./lib/vps/sqlite.mjs
COPY --from=build --chown=node:node /app/drizzle ./drizzle
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "scripts/start-vps.mjs"]
