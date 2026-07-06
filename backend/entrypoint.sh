#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint (backend/) ==="
echo "NODE_ENV=$NODE_ENV"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

# Apply database schema via direct connection
if [ -n "$DATABASE_URL_DIRECT" ]; then
  echo "=== Running prisma db push (via DATABASE_URL_DIRECT) ==="
  DATABASE_URL="$DATABASE_URL_DIRECT" npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1
else
  echo "=== Running prisma db push (via DATABASE_URL) ==="
  npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1
fi
echo "=== Prisma db push done ==="

echo "Starting application..."
exec node dist/main 2>&1
