#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint ==="

# Fix DATABASE_URL to use Supabase pooler (IPv4-compatible)
export DATABASE_URL=$(
  echo "$DATABASE_URL" |
  sed -E 's/db\.([^.]+)\.supabase\.co/aws-1-ap-south-1.pooler.supabase.com/' |
  sed -E 's/^postgresql:\/\/postgres:/postgresql:\/\/postgres.pwgmjaoovhvepmkpqoqu:/' |
  sed -E 's/:5432/:6543/' |
  sed -E 's/\?sslmode=require/?pgbouncer=true\&sslmode=require/'
)

# Push schema in background (tables needed for app)
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1 &

echo "Starting application..."
exec node dist/main 2>&1
