# ── Stage 1: deps ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile --filter @stratus/api...

# ── Stage 2: builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .

RUN pnpm --filter @stratus/api build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 stratus && \
    adduser  --system --uid 1001 stratus

# Only production deps
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/apps/api/package.json ./package.json

USER stratus

EXPOSE 3001

# Run Prisma migrations then start the server
CMD ["sh", "-c", "node node_modules/.bin/prisma migrate deploy && node dist/main"]
