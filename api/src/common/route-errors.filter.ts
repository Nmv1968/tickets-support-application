import { ArgumentsHost, BadRequestException, Catch, HttpException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';

/** The 404 of a method and path the API has no route for. */
export const NO_ROUTE_MESSAGE = 'La ruta no existe.';

/** The 400 of a path with an escape that is not text (`%FF`) where a route reads a parameter. */
export const BAD_PATH_MESSAGE = 'La dirección tiene caracteres que no se pueden leer.';

/**
 * The Spanish answer for one of the two errors that Nest and Express write in English before any
 * route runs, null for any other: the 404 of a method and path without a route (`Cannot GET
 * /api/...`, the wrong method of a route among them) and the 400 of a parameter of the path that
 * cannot be decoded (`Failed to decode param '%FF'`). Every other 404 and 400 is the API's own.
 */
export function routeErrorInSpanish(exception: HttpException, req: Request): HttpException | null {
  // Nest's text names the method and the URL of the request exactly as they came.
  if (exception instanceof NotFoundException && exception.message === `Cannot ${req.method} ${req.originalUrl}`) {
    return new NotFoundException(NO_ROUTE_MESSAGE);
  }
  if (exception instanceof BadRequestException && /^Failed to decode param '.*'$/s.test(exception.message)) {
    return new BadRequestException(BAD_PATH_MESSAGE);
  }
  return null;
}

/** Answers `routeErrorInSpanish`, with the same status and shape; any other error as it comes. */
@Catch(NotFoundException, BadRequestException)
export class RouteErrorsFilter extends BaseExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    super.catch(routeErrorInSpanish(exception, host.switchToHttp().getRequest<Request>()) ?? exception, host);
  }
}
