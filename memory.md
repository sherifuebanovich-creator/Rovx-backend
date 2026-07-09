# ROVX Project Memory

## Project
Road navigation app with user reports, premium subscriptions, and AI photo validation.

## Last Session (Jul 2026)

### Changes Made

1. **Map follow mode improved**
   - Drag no longer disables follow during navigation (`MapViewGL.tsx:87` checks `isNavigatingRef`)
   - Auto-follow when moving >10km/h during navigation (`useGeolocation.ts:70-72`)
   - Recenter button added (bottom-right) when follow is off

2. **Vehicle mode toggle removed entirely**
   - `VehicleModeToggle.tsx` deleted (was dead code, not imported anywhere)
   - Sidebar vehicle mode section removed
   - Store type simplified to `vehicleMode: 'CAR'` only (was `'CAR' | 'TRUCK'`)

3. **NavigationHUD redesigned (Yandex Navigator style)**
   - Top banner: large turn arrow + distance + street name + next maneuver
   - Bottom pill: speed | ETA | distance | controls (mute/exit)
   - Destination name shown below the pill

4. **AI photo validation fixed**
   - `llama` models now recognized as vision-capable (was rejecting Groq models)
   - AI prompts softened: "если сомневаешься — пропускай" instead of "будь максимально строгим"

5. **Xsolla payment integration**
   - Language parameter passed from user locale in token creation
   - Premium tiers now have Russian labels/descriptions (`desc_en`/`desc_ru`)
   - `getTiers()` returns `description` and `label` in correct language

6. **Photo validation overlay fix**
   - Remove photo button moved after validation overlay + `z-10`

7. **Refresh token Redis → DB fallback**
   - `auth.service.ts:141-149`: if Redis is cleared (deploy), falls back to DB stored token
   - Fixes "Unauthorized everywhere" after Render redeploy

8. **Localized error messages**
   - Frontend sends `Accept-Language` header from i18next language (`api.ts`)
   - Backend `http-exception.filter.ts` translates common errors (Unauthorized, Invalid tier, etc.) to Russian
   - Premium `createCheckout` uses `Accept-Language` for Xsolla language selection

9. **BottomBar cleaned up**
   - "Map" button (recenter) removed from bottom bar
   - Only Report and Chats tabs remain
   - `activeTab` default changed to `'report'`

## Current Issues
- Xsolla PayStation returns error — user needs to configure payment methods in Xsolla Publisher Account (Projects → Rovx → Payment methods → add test card)

## Last Session Additions
- `GET /admin/stats` — reports per hour/day/week/month, premium sales, online users with names, server CPU/RAM
- `POST /telegram/webhook` — Telegram bot `/stats` command with inline buttons for premium details
- `GET /admin/stats/premium/:id` — premium purchase details (buyer, price, date)
- BottomBar compacted to rounded pill with 2 buttons (report + chats)
- Auto-redirect to `/auth/login` when refresh token fails
- All errors localized via `Accept-Language` header (RU/EN)

## This Session (Jul 2026)

### Changes Made
1. **AI photo validation: default to reject**
   - Prompt changed from "В остальных случаях — valid: true" to "Если не уверен — valid: false"
   - Both prompts (with/without description) updated

2. **Bot /stats: only count active premium**
   - `admin.service.ts`: all premium count queries filter by `status: 'active'`
   - No longer counts pending/incomplete purchases as real sales

3. **New bot command: /reports**
   - `/reports Москва` — shows up to 20 recent reports for the city
   - `/reports` without args — inline buttons with 8 popular cities
   - City selection callback handled in webhook
   - Reports displayed with emoji, type, time, description, author
   - Circular dependency `ReportsModule ↔ TelegramModule` resolved with `forwardRef`

## Env Vars
| Key | Value |
|-----|-------|
| `XSOLLA_MERCHANT_ID` | `894576` |
| `XSOLLA_PROJECT_ID` | `310319` |
| `XSOLLA_API_KEY` | `57e5fc5fae1c7c549d006e623a1429c65e0ce318` |
| `XSOLLA_WEBHOOK_SECRET` | `kXuuAc_uakvCvYjLFAQZq2cH8YgNhSBTfKP7n8kRnsU` |
| `AI_API_BASE_URL` | `https://api.groq.com/openai/v1` |
| `AI_MODEL` | `llama-3.3-70b-versatile` |
| `AI_VISION_MODEL` | `llama-3.2-11b-vision-preview` |
| `TELEGRAM_BOT_TOKEN` | `8867217059:AAF...` |
| `TELEGRAM_CHAT_ID` | `5859180157` |

## URLs
- Backend: https://rovx-backend-up1u.onrender.com/api/v1
- Frontend: https://rovx-app-livid.vercel.app
- Health: https://rovx-backend-up1u.onrender.com/api/v1/health

## Git
- Repo: `github.com/sherifuebanovich-creator/Rovx-backend` (master branch)
- Push to master → auto-deploy to Render
- Frontend: `vercel --prod --yes` from `frontend/`
- Active source: `src/` (backend `src/` is backup copy of `backend/src/`)
