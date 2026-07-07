# Настройка Neon PostgreSQL

## 1. Создание проекта Neon

1. Зарегистрируйтесь на https://neon.tech
2. Нажмите **"Create a project"**
3. Выберите имя (например, `rovx-db`)
4. Выберите регион (рекомендуется близкий к вашему backend-серверу)
5. Нажмите **"Create project"**

## 2. Получение строки подключения

1. В дашборде проекта перейдите в **Project Settings → Connection Details**
2. Скопируйте строку подключения:
   - Для пулинга (рекомендуется): `postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/rovx_db?sslmode=require&pgbouncer=true`
   - Для прямого подключения (миграции): `postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/rovx_db?sslmode=require`

## 3. Настройка переменных окружения

Добавьте в `.env` или в панели управления хостингом:

```env
DATABASE_URL=postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/rovx_db?sslmode=require&pgbouncer=true
DATABASE_URL_DIRECT=postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/rovx_db?sslmode=require
```

> `DATABASE_URL` использует pgbouncer (пулинг) — для приложения.
> `DATABASE_URL_DIRECT` — прямое подключение для Prisma Migrate.

## 4. Запуск миграций Prisma

```bash
# Установите DATABASE_URL_DIRECT для миграций
export DATABASE_URL_DIRECT="postgresql://..."

# Запуск миграции
npx prisma migrate deploy

# Или для разработки
npx prisma migrate dev
```

## 5. Подключение к Vercel

1. В панели Vercel откройте **Project Settings → Environment Variables**
2. Добавьте `DATABASE_URL` и `DATABASE_URL_DIRECT`
3. Перезалейте проект для применения переменных

## 6. Дополнительно

- **Neon Serverless:** SDK не требуется — используйте стандартный `@prisma/client`
- **Бесплатный лимит:** 500MB данных, 100 часов compute в месяц
- **Мониторинг:** в дашборде Neon доступны графики нагрузки и использования
