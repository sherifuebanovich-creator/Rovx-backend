#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint (backend/) ==="
echo "NODE_ENV=$NODE_ENV"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

# Generate Prisma client from schema
echo "=== Running prisma generate ==="
npx prisma generate --schema=./prisma/schema.prisma 2>&1
echo "=== Prisma generate done ==="

# Apply database schema changes
if [ -n "$DATABASE_URL_DIRECT" ]; then
  echo "=== Running prisma db push (via DATABASE_URL_DIRECT) ==="
  DATABASE_URL="$DATABASE_URL_DIRECT" npx prisma db push --accept-data-loss --schema=./prisma/schema.prisma 2>&1
else
  echo "=== Running prisma db push (via DATABASE_URL) ==="
  npx prisma db push --accept-data-loss --schema=./prisma/schema.prisma 2>&1
fi
echo "=== Prisma db push done ==="

echo "Starting application..."
exec node dist/main 2>&1
