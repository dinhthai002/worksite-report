# Multi-stage build (architecture.md section 9).
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
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
