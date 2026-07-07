# Развёртывание RovX

## Frontend — Vercel

### Подготовка

1. Установите Vercel CLI: `npm i -g vercel`
2. Войдите в аккаунт: `vercel login`

### Деплой

```bash
cd frontend
vercel --prod
```

Или подключите Git-репозиторий в дашборде Vercel:
1. Зайдите на https://vercel.com
2. Нажмите **"Add New Project"**
3. Импортируйте ваш репозиторий
4. Укажите Root Directory: `frontend`
5. Добавьте переменные окружения (см. ниже)
6. Нажмите **"Deploy"**

### Переменные окружения для Vercel

| Переменная | Значение |
|---|---|
| `NEXTAUTH_URL` | `https://rovx-app-livid.vercel.app` |
| `NEXT_PUBLIC_API_URL` | `https://rovx-backend.onrender.com/api/v1` |
| `NEXT_PUBLIC_WS_URL` | `wss://rovx-backend.onrender.com` |

---

## Backend — Render

### Подготовка

Убедитесь, что в корне проекта есть `render.yaml`:

```yaml
services:
  - type: web
    name: rovx-backend
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm run start:prod
```

### Деплой

1. Зайдите на https://render.com
2. Нажмите **"New +" → "Web Service"**
3. Подключите Git-репозиторий
4. Настройте:
   - **Name:** `rovx-backend`
   - **Root Directory:** (корень проекта)
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start:prod`
5. Добавьте переменные окружения (см. ниже)
6. Выберите тариф (Free подойдёт для старта)
7. Нажмите **"Create Web Service"**

### Переменные окружения для Render

| Переменная | Описание |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` (Render назначает сам) |
| `DATABASE_URL` | Строка подключения к Neon (с pgbouncer) |
| `DATABASE_URL_DIRECT` | Прямая строка подключения к Neon |
| `REDIS_URL` | URL Redis (например, от Redis Cloud) |
| `JWT_SECRET` | Секрет JWT (случайная строка 32+ символа) |
| `JWT_REFRESH_SECRET` | Секрет refresh JWT |
| `CORS_ORIGIN` | `https://rovx-app-livid.vercel.app` |
| `FRONTEND_URL` | `https://rovx-app-livid.vercel.app` |
| `SMTP_HOST` | SMTP-сервер для писем |
| `SMTP_USER` | Логин SMTP |
| `SMTP_PASS` | Пароль SMTP |
| `GOVERNMENT_API_URL` | URL правительственного API |
| `GOVERNMENT_API_KEY` | Ключ API |

---

## Neon PostgreSQL

См. подробную инструкцию в [NEON_SETUP.md](./NEON_SETUP.md).

### Краткая инструкция

1. Создайте проект на https://neon.tech
2. Скопируйте строки подключения
3. Установите `DATABASE_URL` и `DATABASE_URL_DIRECT` на Render/Vercel
4. Запустите миграции Prisma:

```bash
DATABASE_URL_DIRECT="postgresql://..." npx prisma migrate deploy
```

---

## Полный список переменных окружения

| Переменная | Где требуется | Обязательная |
|---|---|---|
| `DATABASE_URL` | Backend | Да |
| `DATABASE_URL_DIRECT` | Backend (миграции) | Да |
| `REDIS_URL` | Backend | Да |
| `JWT_SECRET` | Backend | Да |
| `JWT_REFRESH_SECRET` | Backend | Да |
| `CORS_ORIGIN` | Backend | Да |
| `FRONTEND_URL` | Backend | Да |
| `SMTP_HOST` | Backend | Для писем |
| `SMTP_PORT` | Backend | Для писем |
| `SMTP_USER` | Backend | Для писем |
| `SMTP_PASS` | Backend | Для писем |
| `MAIL_FROM` | Backend | Для писем |
| `NEXTAUTH_URL` | Frontend | Да |
| `NEXT_PUBLIC_API_URL` | Frontend | Да |
| `NEXT_PUBLIC_WS_URL` | Frontend | Для веб-сокетов |
| `STRIPE_SECRET_KEY` | Backend | Для премиума |
| `STRIPE_WEBHOOK_SECRET` | Backend | Для премиума |
| `TELEGRAM_BOT_TOKEN` | Backend | Для уведомлений |
| `TELEGRAM_CHAT_ID` | Backend | Для уведомлений |
| `GOVERNMENT_API_URL` | Backend | Для гос. данных |
| `GOVERNMENT_API_KEY` | Backend | Для гос. данных |

---

## Проверка деплоя

После деплоя проверьте:

- Backend: `https://rovx-backend.onrender.com/api/v1/health`
- Frontend: `https://rovx-app-livid.vercel.app`
- Swagger: `https://rovx-backend.onrender.com/docs` (если включено)
