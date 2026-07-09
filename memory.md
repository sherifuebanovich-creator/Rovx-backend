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

## Current Issues
- Xsolla sandbox returns error 0004-0002 — user needs to configure payment methods in Xsolla Publisher Account

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
