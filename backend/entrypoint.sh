#!/bin/sh
set -e

echo "=== ROVX Backend Entrypoint ==="

# DATABASE_URL_DIRECT — original direct Supabase URL (for DDL: prisma db push)
export DATABASE_URL_DIRECT="$DATABASE_URL"

# Fix DATABASE_URL to use Supabase pooler (IPv4-compatible, for runtime queries)
export DATABASE_URL=$(
  echo "$DATABASE_URL" |
  sed -E 's/db\.([^.]+)\.supabase\.co/aws-1-ap-south-1.pooler.supabase.com/' |
  sed -E 's/^postgresql:\/\/postgres:/postgresql:\/\/postgres.pwgmjaoovhvepmkpqoqu:/' |
  sed -E 's/:5432/:6543/' |
  sed -E 's/\?sslmode=require/?pgbouncer=true\&sslmode=require/'
)

# Push schema via direct connection (PgBouncer blocks DDL)
echo "=== Running prisma db push ==="
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss 2>&1
echo "=== Prisma db push done ==="

# Runtime patch: remove `include:{preferences:true}` from compiled auth service
# This fixes registration hanging on non-verified users (Prisma include SELECT timeout)
echo "=== Applying runtime patch for auth service ==="
sed -i 's/,include:{preferences:true}//g' dist/auth/auth.service.js 2>/dev/null || true
sed -i 's/,"include":{"preferences":true}//g' dist/auth/auth.service.js 2>/dev/null || true

echo "Starting application..."
exec node dist/main 2>&1
