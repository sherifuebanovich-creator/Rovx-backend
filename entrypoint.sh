#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint ==="

# Fix DATABASE_URL to use Supabase pooler port (IPv4 compatible)
export DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/:5432\//:6543\//' | sed 's/\?sslmode=require/\?pgbouncer=true\&sslmode=require/')

echo "Running db push..."
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1 || echo "db push skipped (non-fatal)"

echo "Starting application..."
exec node dist/main
