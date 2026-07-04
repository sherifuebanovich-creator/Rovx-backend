#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint ==="

# Push schema to database (creates tables if not exist)
echo "Running db push..."
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1 || echo "db push skipped"

# Seed demo data (only if DB is empty)
echo "Seeding data..."
if ! npx ts-node prisma/seed.ts 2>/dev/null; then
  echo "Seed skipped (data may already exist)"
fi

echo "Starting application..."
exec node dist/main
