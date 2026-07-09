#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint ==="
echo "NODE_ENV=$NODE_ENV"

# DATABASE_URL — connection for runtime queries (use pooler for production)
# DATABASE_URL_DIRECT — direct connection for DDL (prisma db push)
# Set both in your Render dashboard environment variables

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

# Apply database schema via direct connection (PgBouncer blocks DDL)
if [ -n "$DATABASE_URL_DIRECT" ]; then
  echo "=== Running prisma db push (via DATABASE_URL_DIRECT) ==="
  DATABASE_URL="$DATABASE_URL_DIRECT" npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1 || echo "WARN: prisma db push failed (non-fatal)"
else
  echo "=== Running prisma db push (via DATABASE_URL) ==="
  npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1 || echo "WARN: prisma db push failed (non-fatal)"
fi
echo "=== Prisma db push done ==="

echo "Starting application..."
exec node dist/main 2>&1
