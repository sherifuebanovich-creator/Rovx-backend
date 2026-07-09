# ROVX Project - AI Agent Instructions

## Stack
- Backend: NestJS, PostgreSQL (Neon), Redis (Render), Prisma ORM
- Frontend: Next.js 14, deployed on Vercel
- Payment: Lava.top (lava.top)

## URLs
- Backend API: https://rovx-backend-up1u.onrender.com/api/v1
- Frontend: https://rovx-app-livid.vercel.app
- Health: https://rovx-backend-up1u.onrender.com/api/v1/health

## Git
- Repo: `github.com/sherifuebanovich-creator/Rovx-backend`
- Pushes to `master` auto-deploy to Render (Docker) and GitHub Actions build
- Frontend deploys via Vercel CLI (`vercel --prod --yes` from `frontend/`)

## Payment (Xsolla — xsolla.com)
- Create token: `POST https://api.xsolla.com/merchant/v2/merchants/{merchant_id}/token`
- Auth: `Authorization: Basic {base64(api_key:)}`
- PayStation URL: `https://secure.xsolla.com/paystation3/?token={token}`
- Webhook: `POST /api/v1/premium/webhook` (events: `user_validation`, `payment`)
- Webhook auth header: `Authorization: Signature <algorithm> <signature>`
- Xsolla merchant/project IDs + API key + webhook secret must be set in Render
- Prices: $5 (Basic), $10 (Standard), $20 (Max)

## Prisma Schemas
- Root: `prisma/schema.prisma` - has `provider` field (default `"xsolla"`)
- Backend: `backend/prisma/schema.prisma` - same

## Backend Source
- Docker builds from `src/` (NOT `backend/src/`)
- Backend `src/` is the active codebase
- `backend/src/` is a backup/copy

## Env Vars Required in Render
- `XSOLLA_MERCHANT_ID` - merchant ID from Publisher Account
- `XSOLLA_API_KEY` - API key from Publisher Account
- `XSOLLA_PROJECT_ID` - project ID from Publisher Account
- `XSOLLA_WEBHOOK_SECRET` - webhook secret from Publisher Account

## Common Issues
1. **Cold start**: Render free tier spins down after inactivity (50+ sec delay)
2. **Loading stuck**: `Promise.all` in premium page can hang if one API call fails. Fixed with `Promise.allSettled`
3. **Payment fails**: Check Render logs for "Lava create payment failed" - usually amount/currency issue
4. **Frontend not updating**: Run `vercel --prod --yes` from `frontend/`
5. **Service worker stale cache**: Unregistered in `Providers.tsx`

## Build Commands
- Backend: `npm run build` (or `npx nest build`)
- Frontend: `npm run build` (from `frontend/`)
- Deploy frontend: `vercel --prod --yes` (from `frontend/`)
