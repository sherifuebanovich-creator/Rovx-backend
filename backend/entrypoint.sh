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
  echo "=== Running prisma migrate deploy (via DATABASE_URL_DIRECT) ==="
  DATABASE_URL="$DATABASE_URL_DIRECT" npx prisma migrate deploy --schema=./prisma/schema.prisma 2>&1
else
  echo "=== Running prisma migrate deploy (via DATABASE_URL) ==="
  npx prisma migrate deploy --schema=./prisma/schema.prisma 2>&1
fi
echo "=== Prisma migrate deploy done ==="

echo "Starting application..."
exec node dist/main 2>&1
