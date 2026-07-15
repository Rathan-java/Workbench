# =============================================================================
#  Ara Workbench API — production image
#
#  Multi-stage on purpose:
#    - The final image carries no dev dependencies, no source maps, no build
#      toolchain and no shell history. Smaller image, smaller attack surface.
#    - Prisma's engine binaries are generated in a stage that matches the runtime
#      libc (Alpine → musl), because a client generated against glibc silently
#      fails at runtime with an unhelpful "engine not found".
# =============================================================================

# --- deps --------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# openssl is required by Prisma's query engine on Alpine.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

# `npm install`, not `npm ci`: this is an npm WORKSPACES monorepo, so the single
# package-lock.json lives at the repo root and never in this per-app build
# context. `npm ci` would fail here for want of a lockfile it will never see.
#
# Install everything (the Prisma CLI is a devDependency and is needed to run
# `prisma generate`), generate the client against Alpine's musl, THEN prune the
# dev dependencies away — so the node_modules this stage hands to production
# carries the generated client but none of the build toolchain.
RUN npm install --no-audit --no-fund \
 && npx prisma generate \
 && npm prune --omit=dev


# --- builder (dev deps, for linting/tests in CI) ------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --no-audit --no-fund && npx prisma generate
COPY . .
RUN npm run lint


# --- production --------------------------------------------------------------
FROM node:22-alpine AS production
WORKDIR /app

RUN apk add --no-cache openssl tini

ENV NODE_ENV=production
# Bound the heap explicitly. Node's default is a fraction of *host* memory, which
# inside a 512 MB container means V8 happily grows past the cgroup limit and the
# process is OOM-killed with no useful error.
ENV NODE_OPTIONS="--max-old-space-size=768"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package*.json ./
COPY src ./src

# Writable, owned by the unprivileged user.
RUN mkdir -p storage/uploads/avatars storage/logs \
 && chown -R node:node /app

# Never run as root. A container escape from a root process owns the host.
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as PID 1: Node does not reap zombies and does not forward SIGTERM to
# children. Without an init, `docker stop` waits the full 10s then SIGKILLs —
# severing in-flight requests and defeating the graceful shutdown in server.js.
ENTRYPOINT ["/sbin/tini", "--"]

# Migrations run at boot, not at build. `migrate deploy` is idempotent and only
# applies what is pending, so a rolling deploy of three instances is safe.
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js && node src/server.js"]
