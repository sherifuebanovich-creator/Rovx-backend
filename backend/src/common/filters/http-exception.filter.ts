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

const RU: Record<string, string> = {
  'Invalid tier': 'Неверный тариф',
  'Xsolla payment is not configured': 'Платёжная система Xsolla не настроена',
  'User not found': 'Пользователь не найден',
  'Unauthorized': 'Требуется авторизация',
  'Internal server error': 'Внутренняя ошибка сервера',
  'Validation failed': 'Ошибка валидации',
  'Photo does not match the description': 'Фото не соответствует описанию',
  'Description does not match the event type': 'Описание не соответствует типу события',
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
      message = exception.message;
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
