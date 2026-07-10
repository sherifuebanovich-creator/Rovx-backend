# ── Stage 1: Builder ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY backend/package*.json ./
RUN npm install

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npx nest build 2>&1 || (echo "=== nest build failed, falling back to tsc ===" && npx tsc -p tsconfig.json --skipLibCheck --noEmitOnError false)

# ── Stage 2: Runner ───────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends wget python3 python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install edge-tts 2>/dev/null || true

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

RUN mkdir -p uploads/avatars uploads/reports

COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
