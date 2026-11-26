# Multi-stage build (architecture.md section 8).
# build:   installs all dependencies, generates the Prisma client, compiles TypeScript
# runtime: production dependencies and compiled output only, running as a non-root user
# The same image serves the `migrate` and `api` services in docker-compose.yml.

FROM node:22.23.4-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate`.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Production dependencies include the Prisma CLI, which the `migrate` service runs.
# Prisma lists TypeScript as an optional peer dependency, so npm installs it even with --omit=dev.
# Nothing needs it at runtime; removing it saves about 24 MB.
# npm itself is removed last: the container runs only `node` and `node_modules/.bin/prisma`, and the npm CLI
# bundled with the base image carries its own vulnerable dependencies (found by the Trivy scan in CI).
RUN npm ci --omit=dev \
  && rm -rf node_modules/typescript node_modules/.bin/tsc node_modules/.bin/tsserver \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
