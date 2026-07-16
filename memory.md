

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

10. **Bot commands**
    - `/reports` — выбор страны (СНГ) → города → репорт с фото/описанием/координатами/временем
    - `/online` — кто сейчас онлайн (с городом)
    - `/premium` — продажи премиума (с inline-кнопками деталей)
    - `/server` — нагрузка CPU/RAM
    - `/start` — приветствие со списком команд
    - Ежечасный отчёт через `TasksService` (`@Cron`)
    - `sendPhotoToChat()` добавлен в TelegramService

11. **Map: user marker → dot**
    - Треугольник (стрелка) заменён на синий кружок с маленькой стрелкой направления
    - Кнопка центрирования снизу справа удалена (дублирует кнопку в TopBar)

## Current Issues
- Xsolla PayStation returns error — user needs to configure payment methods in Xsolla Publisher Account (Projects → Rovx → Payment methods → add test card)

## This Session (Jul 2026)

### Changes Made
1. **REQUEST_HEADER_TOO_LARGE** — убрал `rovxUser` из NextAuth JWT callback (был весь объект пользователя ~2KB в куке `next-auth.session-token`), переименовал куку в `rovx-session-token` (чтобы старый большой токен игнорировался), убрал `withCredentials: true` из axios
2. **Hourly Telegram report** — `TasksService` с `@Cron(EVERY_HOUR)` шлёт статистику в Telegram (репорты, премиум, онлайн, сервер)
3. **CIS countries** — Узбекистан, Украина, Азербайджан, Армения, Кыргызстан, Таджикистан, Туркменистан, Молдова с их городами
4. **/stats removed** — `/start` показывает только `/reports`, `/online`, `/premium`, `/server`
5. **MapAppLoader stuck fix** — добавлен `setTimeout(done, 3000)` safety fallback; если `rovx-auth` в localStorage битый (isAuthenticated: false), приложение не зависало на загрузке навсегда

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

## This Session (2026-07-16) — full bug audit + deploy fix

Ran a 3-agent review (backend/frontend/infra) across the whole repo, then fixed everything found. Backend, frontend both typecheck + build clean.

### Fixed (backend)
1. **Report photos were completely broken** — `validatePhoto()` did `new URL()` on relative `/uploads/...` paths (throws) and rejected `data:` base64 URLs the frontend sends for pre-flight checks (protocol not http/https). Now resolves relative paths via `BACKEND_URL` and accepts `data:image/...;base64,` with a size cap. This was blocking every hazard report with a photo.
2. WebSocket `handleConnection` didn't check ban/blacklist (REST did) — banned/logged-out users kept live socket access. Now calls `AuthService.validateJwtPayload`; `AdminService.banUser` also force-disconnects the user's active sockets via a new `GatewayService.disconnectUser()`.
3. `getGroupById` leaked private group member lists to non-members; `getInviteToken` only checked membership, not admin — both fixed.
4. SSRF blocklist for AI photo validation now also blocks `169.254.0.0/16` (cloud metadata).
5. Telegram `/setpass` no longer echoes the plaintext password into chat; now also clears the target's `refreshToken` to revoke old sessions.
6. `getPaymentDetails()` had a hardcoded fallback card number — now fails closed (`BadRequestException`) if `PAYMENT_CARD_*` env vars aren't set, instead of silently showing a stale/wrong card.
7. Xsolla webhook inferred tier from `paidAmount` without dividing by `months` — multi-month purchases could get upgraded to the wrong tier. Now prefers the tier already recorded on the `pending` subscription row written at checkout time. Same idempotency fix (dedupe by `transactionId`/`invoiceId`/`orderId`, not just `status==='active'`) applied to Xsolla, Lava.top, Lemon Squeezy webhooks — the old check was blocking legitimate renewal payments, not just webhook redelivery.
8. Added missing env vars to `.env.example` + `render.yaml`: `TELEGRAM_WEBHOOK_SECRET` (was completely unset in prod → webhook signature check silently skipped), `PAYMENT_CARD_*`, Stripe/LemonSqueezy/LavaTop keys.

### Fixed (deploy/infra)
9. **`render.yaml` pointed at the top-level `Dockerfile`/context, which cannot build** (root `.dockerignore` excludes `backend/`, so `COPY entrypoint.sh` fails). Repointed to `backend/Dockerfile` + `backend` context — matches what `docker-compose.yml`/`cloudbuild.yaml` already use. Added `backend/.dockerignore` (didn't exist) so `COPY . .` in the Dockerfile can't overwrite the container's freshly-installed `node_modules` with the host's local one.
10. Deleted the stale top-level `prisma/` (schema had drifted from `backend/prisma/` — missing `GroupRequest`/`GroupFavorite`/`MapFeature` models — and nothing in the code referenced it). It also had a committed `dev.db` SQLite file since the initial commit. `backend/prisma/` is the real one, already used correctly by `backend/Dockerfile`'s `entrypoint.sh`.

### Fixed (frontend)
11. Follow-mode on the map re-enabled itself 5s after `dragstart`/`zoomstart` even if the user was still actively panning — camera would yank back mid-gesture. Timer now starts on `dragend`/`zoomend` instead.
12. `groups/[id]/page.tsx` registered a `'connect'` socket listener inside a `.then()` that was never in the effect's cleanup — stacked a new listener (and duplicate `getGroupMessages` fetches) every time the effect re-ran (e.g. `user` object identity change).
13. `ReportPanel.tsx` photo validation used array-index writes (`copy[startIndex+i]`) that went stale if a photo was removed while its AI validation was still in flight — could permanently disable the submit button. Now tracks photos by a stable id and writes results by looking up the photo's current index.
14. `api.ts`'s token-refresh path re-set the `access_token` cookie without `secure`/`sameSite` (present on initial login) — reapplied both attributes.
15. `useSocket.ts`'s `connect()` tore down and restarted the socket if it was still mid-handshake (not yet `.connected`), which a second consumer mounting around the same time would trigger. Now reuses any existing instance regardless of connection state.
16. **Voice calls (`VoiceChat.tsx`) had no real audio transport** — full call UI + socket signaling (`voice:call`/`voice:signal`) but no `RTCPeerConnection` anywhere, so no audio ever played. Implemented full offer/answer/ICE-candidate exchange over the existing `voice:signal` relay (backend gateway already forwarded it opaquely, no backend change needed). STUN only (`stun.l.google.com`), no TURN server — calls behind strict/symmetric NAT may still fail to connect; there's no TURN infra in this deployment.

### Not touched
- The plaintext secrets already committed in this file and in `frontend/.env.production` (`NEXTAUTH_SECRET`) — user said leave them for now, rotate separately later.
- The GitHub PAT embedded in `git remote -v` origin/target URLs — same, not touched.
- Alternate payment rails (Payme, CloudPayments, Iyzico, YooKassa) — env vars documented in `.env.example` for reference but not wired into `render.yaml`; they look unused/stub (no active checkout flow references them beyond the webhook handlers).

### Still needs manual action in Render/Vercel dashboards
- Set `TELEGRAM_WEBHOOK_SECRET` in Render (backend) — the var is now declared in `render.yaml` but the actual secret value must be set manually (`sync: false`) and configured on the Telegram Bot API side (`setWebhook` with `secret_token`).
- Set `PAYMENT_CARD_NUMBER`/`PAYMENT_CARD_HOLDER`/`PAYMENT_CARD_BANK` in Render if the manual-payment-via-Telegram flow is still in use — `getPaymentDetails()` now returns an error instead of a hardcoded card until these are set.
