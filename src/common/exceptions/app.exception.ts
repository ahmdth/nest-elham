import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_UNAVAILABLE'
  | 'BOOKING_NOT_FOUND'
  | 'INTERNAL_ERROR';

export class AppException extends HttpException {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, status: HttpStatus) {
    super({ error: { code, message } }, status);
    this.code = code;
  }

  static validation(message = 'The request body or parameters are invalid.') {
    return new AppException('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST);
  }

  static slotNotFound(message = 'No slot exists with the given id.') {
    return new AppException('SLOT_NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }

  static slotUnavailable(
    message = 'This slot already has an active booking.',
  ) {
    return new AppException(
      'SLOT_UNAVAILABLE',
      message,
      HttpStatus.CONFLICT,
    );
  }

  static bookingNotFound(message = 'No booking exists with the given id.') {
    return new AppException(
      'BOOKING_NOT_FOUND',
      message,
      HttpStatus.NOT_FOUND,
    );
  }

  static internal(message = 'An unexpected error occurred.') {
    return new AppException(
      'INTERNAL_ERROR',
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
