import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

const EN: Record<string, string> = {
  'Invalid tier': 'Invalid tier',
  'Xsolla payment is not configured': 'Xsolla payment is not configured',
  'User not found': 'User not found',
  'Unauthorized': 'Unauthorized',
  'Internal server error': 'Internal server error',
  'Validation failed': 'Validation failed',
  'Photo does not match the description': 'Photo does not match the description',
  'Description does not match the event type': 'Description does not match the event type',
};

// Most business-logic exceptions across the backend are thrown with a
// Russian message directly at the call site (this app's primary audience).
// This map exists for the messages that were left in English — without it,
// the frontend (which now surfaces the real backend message instead of a
// generic fallback, see api.ts) showed a jarring mix of Russian UI text and
// raw English error text for anything not covered here.
const RU: Record<string, string> = {
  'Invalid tier': 'Неверный тариф',
  'Xsolla payment is not configured': 'Платёжная система Xsolla не настроена',
  'User not found': 'Пользователь не найден',
  'Unauthorized': 'Требуется авторизация',
  'Internal server error': 'Внутренняя ошибка сервера',
  'Validation failed': 'Ошибка валидации',
  'Photo does not match the description': 'Фото не соответствует описанию',
  'Description does not match the event type': 'Описание не соответствует типу события',

  'Account has been banned': 'Аккаунт заблокирован',
  'Account is deactivated': 'Аккаунт деактивирован',
  'Ad not found': 'Реклама не найдена',
  'Admin already exists. Use /admin/users/:id/role to promote users.': 'Админ уже существует. Используйте /admin/users/:id/role, чтобы повысить пользователя.',
  'AI Co-Driver requires a premium subscription': 'AI Co-Driver доступен только по премиум-подписке',
  'Already following': 'Вы уже подписаны',
  'Already friends': 'Вы уже друзья',
  'Already subscribed': 'Вы уже подписаны',
  'Authentication failed': 'Ошибка аутентификации',
  'Bounding box too large (max 10° per axis)': 'Слишком большая область (максимум 10° по каждой оси)',
  'Cannot act on a user with an equal or higher role': 'Нельзя выполнить действие над пользователем с равной или более высокой ролью',
  'Cannot add yourself': 'Нельзя добавить самого себя',
  'Cannot ban yourself': 'Нельзя заблокировать самого себя',
  'Cannot change your own role': 'Нельзя изменить свою собственную роль',
  'Cannot delete this report': 'Нельзя удалить этот репорт',
  'Cannot follow yourself': 'Нельзя подписаться на самого себя',
  'Cannot grant a role equal to or higher than your own': 'Нельзя назначить роль, равную или выше своей',
  'Cannot reset password for Google-only accounts': 'Нельзя сбросить пароль для аккаунта, привязанного только к Google',
  'Cannot unban yourself': 'Нельзя разблокировать самого себя',
  'Cannot vote on expired, rejected, or resolved report': 'Нельзя голосовать за истёкший, отклонённый или закрытый репорт',
  'Cannot vote on own report': 'Нельзя голосовать за свой репорт',
  'City and content required': 'Город и текст сообщения обязательны',
  'command is required': 'Команда обязательна',
  'Coordinates out of range': 'Координаты вне допустимого диапазона',
  'Country must be a 2-letter ISO code (e.g. UZ, KZ)': 'Страна должна быть в формате 2-буквенного ISO-кода (например, UZ, KZ)',
  'countryCode must be a 2-letter ISO code': 'countryCode должен быть 2-буквенным ISO-кодом',
  'elements must be a non-empty array': 'elements должен быть непустым массивом',
  'Email already registered': 'Этот email уже зарегистрирован',
  'Email already verified': 'Email уже подтверждён',
  'email and password required': 'Email и пароль обязательны',
  'Failed to verify Google ID token': 'Не удалось проверить Google ID токен',
  'Friend locations require Premium Standard or higher': 'Местоположение друзей доступно с тарифа Premium Standard и выше',
  'Google email not verified': 'Email в Google не подтверждён',
  'Google ID token audience mismatch': 'Google ID токен выдан для другого приложения',
  'Google sign-in is not configured': 'Вход через Google не настроен',
  'Group not found': 'Группа не найдена',
  'imageUrl is required': 'imageUrl обязателен',
  'Insufficient permissions': 'Недостаточно прав',
  'Invalid coordinates': 'Некорректные координаты',
  'Invalid credentials': 'Неверные учётные данные',
  'Invalid Google ID token': 'Некорректный Google ID токен',
  'Invalid Google ID token payload': 'Некорректное содержимое Google ID токена',
  'Invalid or expired refresh token': 'Недействительный или истёкший refresh-токен',
  'Invalid or expired reset code': 'Недействительный или истёкший код сброса пароля',
  'Invalid or expired verification code': 'Недействительный или истёкший код подтверждения',
  'Invalid refresh token': 'Недействительный refresh-токен',
  'Invalid request body': 'Некорректное тело запроса',
  'Invalid webhook signature': 'Некорректная подпись вебхука',
  'Latitude must be between -90 and 90': 'Широта должна быть от -90 до 90',
  'Lemon Squeezy payment is not configured': 'Оплата через Lemon Squeezy не настроена',
  'liters is required and must be a number': 'liters обязателен и должен быть числом',
  'Longitude must be between -180 and 180': 'Долгота должна быть от -180 до 180',
  'Message cannot be empty': 'Сообщение не может быть пустым',
  'Message is required': 'Сообщение обязательно',
  'Message must be 2000 characters or fewer': 'Сообщение должно быть не длиннее 2000 символов',
  'Message too long (max 2000 characters)': 'Сообщение слишком длинное (максимум 2000 символов)',
  'minLat must be less than maxLat, minLng less than maxLng': 'minLat должен быть меньше maxLat, minLng меньше maxLng',
  'Missing Google ID token': 'Отсутствует Google ID токен',
  'name is required': 'Имя обязательно',
  'No audio file uploaded': 'Аудиофайл не загружен',
  'No file uploaded': 'Файл не загружен',
  'No files uploaded': 'Файлы не загружены',
  'No video file uploaded': 'Видеофайл не загружен',
  'Not a member of this group': 'Вы не состоите в этой группе',
  'Not authenticated': 'Требуется авторизация',
  'Not available': 'Недоступно',
  'Only admin can edit group': 'Редактировать группу может только администратор',
  'Only owner can delete group': 'Удалить группу может только владелец',
  'Only the room owner can close it': 'Закрыть комнату может только её владелец',
  'password must be at least 8 characters': 'Пароль должен содержать не менее 8 символов',
  'Payment details are not configured': 'Платёжные реквизиты не настроены',
  'Payment initiation failed. Please try again.': 'Не удалось инициировать оплату. Попробуйте ещё раз.',
  'phone is required': 'Телефон обязателен',
  'Premium subscription not found': 'Премиум-подписка не найдена',
  'proof must be exactly 4 digits': 'Код подтверждения должен состоять ровно из 4 цифр',
  'Query must be 1-200 characters': 'Запрос должен быть от 1 до 200 символов',
  'Refresh token required': 'Требуется refresh-токен',
  'Report creation already in progress, try again': 'Создание репорта уже выполняется, попробуйте ещё раз',
  'Report not found': 'Репорт не найден',
  'Request already sent': 'Заявка уже отправлена',
  'Request not found': 'Заявка не найдена',
  'Route not found': 'Маршрут не найден',
  'Server configuration error': 'Ошибка конфигурации сервера',
  'Stripe is not configured': 'Stripe не настроен',
  'Text is required': 'Текст обязателен',
  'Text too long (max 500 characters)': 'Текст слишком длинный (максимум 500 символов)',
  'This Google account is already linked to a different user': 'Этот аккаунт Google уже привязан к другому пользователю',
  'Token refresh in progress, try again': 'Обновление токена уже выполняется, попробуйте ещё раз',
  'Trip already being started, try again': 'Поездка уже запускается, попробуйте ещё раз',
  'Trip is not active': 'Поездка не активна',
  'Trip not found': 'Поездка не найдена',
  'User is already an admin': 'Пользователь уже администратор',
  'User not active': 'Пользователь неактивен',
  'Username already taken': 'Это имя пользователя уже занято',
  'Vehicle not found': 'Транспортное средство не найдено',
  'Voice room is full': 'Голосовая комната заполнена',
  'Voice room not found': 'Голосовая комната не найдена',
  'YooKassa is not configured': 'YooKassa не настроена',
  'Failed to deliver your message to support. Please try again.': 'Не удалось доставить сообщение в поддержку. Попробуйте ещё раз.',
  'TTS service unavailable': 'Сервис озвучки недоступен',
};

function translate(msg: string, lang: string): string {
  if (lang?.startsWith('ru')) return RU[msg] || msg;
  return EN[msg] || msg;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const lang = (request.headers['accept-language'] as string) || 'en';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = translate(exceptionResponse, lang);
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as any;
        message = resp.message || message;
        if (Array.isArray(resp.message)) {
          errors = resp.message.map((m: string) => translate(m, lang));
          message = translate('Validation failed', lang);
        } else if (typeof message === 'string') {
          message = translate(message, lang);
        }
      }
    } else if (exception instanceof Error) {
      // Never echo a raw, unclassified error message to the client — e.g. a
      // Prisma "Unique constraint failed" from a racing duplicate-register,
      // or the JWT-secrets-missing config error, would otherwise leak
      // internal implementation/config details straight into the response
      // body. Log the real message server-side; the client gets a generic one.
      message = translate('Internal server error', lang);
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
