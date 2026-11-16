import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/**
 * The whole seconds of `Retry-After` for a wait of `ms` milliseconds: rounded up, and at least 1, so
 * that a client told to wait never comes back a moment too soon or at once.
 */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/** A 429 that says in the standard `Retry-After` header how long is left (see `RetryAfterFilter`). */
export class TooManyAttemptsException extends HttpException {
  readonly retryAfter: number;

  constructor(message: string, remainingMs: number) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
    this.retryAfter = retryAfterSeconds(remainingMs);
  }
}

/**
 * Writes the `Retry-After` of a `TooManyAttemptsException` and answers it as Nest answers every
 * other error, `{ statusCode, message }`. The 429 of the general limit has its header from the
 * throttler library already.
 */
@Catch(TooManyAttemptsException)
export class RetryAfterFilter extends BaseExceptionFilter {
  catch(exception: TooManyAttemptsException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(exception.retryAfter));
    super.catch(exception, host);
  }
}
