#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint ==="

# Run database migrations
echo "Running migrations..."
npx prisma migrate deploy --schema=./prisma/schema.prisma 2>/dev/null || echo "Migration skipped (no new migrations)"

# Seed demo data (only if DB is empty)
echo "Seeding data..."
npx ts-node prisma/seed.ts 2>/dev/null || echo "Seed skipped (data may already exist)"

echo "Starting application..."
exec node dist/main
