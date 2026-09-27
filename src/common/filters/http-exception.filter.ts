import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception.js';

/**
 * Catches every exception thrown anywhere in the app (including Nest's
 * built-in ValidationPipe/ParseUUIDPipe errors and malformed-JSON body
 * parsing errors) and normalizes the response to:
 *   { "error": { "code": "...", "message": "..." } }
 *
 * Never leaks stack traces or internal details to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Our own, already-well-formed business exceptions.
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    // Any other Nest HttpException: built-in ValidationPipe failures,
    // ParseUUIDPipe failures, malformed JSON bodies (body-parser throws a
    // SyntaxError that Nest wraps into a 400 BadRequestException), 404 for
    // unknown routes, etc. We treat every 4xx here as a validation problem
    // unless it's a 404 route-not-found, which we also surface as a plain
    // validation-style error since it is still a malformed request as far
    // as this API's contract is concerned.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = extractMessage(exception);

      if (status >= 400 && status < 500) {
        response
          .status(HttpStatus.BAD_REQUEST)
          .json({ error: { code: 'VALIDATION_ERROR', message } });
        return;
      }

      this.logger.error(message, (exception as Error).stack);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
        },
      });
      return;
    }

    // Truly unexpected errors (DB down, programming errors, etc.) -> never
    // leak details, just log server-side and return a generic 500.
    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      exception instanceof Error ? exception.stack : undefined,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    });
  }
}

function extractMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const anyBody = body as Record<string, unknown>;
    if (Array.isArray(anyBody.message)) {
      return (anyBody.message as unknown[]).join('; ');
    }
    if (typeof anyBody.message === 'string') return anyBody.message;
  }
  return exception.message || 'Invalid request.';
}
