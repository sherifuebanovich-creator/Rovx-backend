#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint ==="

# Push schema to database (creates tables if not exist)
echo "Running db push..."
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1 || echo "db push skipped (non-fatal)"

echo "Starting application..."
exec node dist/main
