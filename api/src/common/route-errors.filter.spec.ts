import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { BAD_PATH_MESSAGE, NO_ROUTE_MESSAGE, routeErrorInSpanish } from './route-errors.filter';

describe('the errors of the routing, in Spanish', () => {
  const req = (method: string, originalUrl: string) => ({ method, originalUrl }) as Request;

  // What Nest throws for a request no route takes, and for a parameter of the path Express cannot decode.
  it('replaces the 404 Nest writes for a method and path without a route', () => {
    expect(routeErrorInSpanish(new NotFoundException('Cannot GET /api/nada?x=1'), req('GET', '/api/nada?x=1'))).toEqual(new NotFoundException(NO_ROUTE_MESSAGE));
    expect(routeErrorInSpanish(new NotFoundException('Cannot PUT /api/tickets'), req('PUT', '/api/tickets'))).toEqual(new NotFoundException(NO_ROUTE_MESSAGE));
  });

  it("replaces the 400 of a parameter of the path that is not text, Express's text", () => {
    expect(routeErrorInSpanish(new BadRequestException("Failed to decode param '%FF'"), req('GET', '/api/tickets/%FF'))).toEqual(
      new BadRequestException(BAD_PATH_MESSAGE),
    );
  });

  // A route that throws a 404 or a 400 wrote its own Spanish text.
  it('leaves every other 404 and 400 as the route wrote it', () => {
    for (const exception of [
      new NotFoundException('El caso no existe'),
      new NotFoundException('Cannot GET /api/otra'),
      new BadRequestException('El identificador «id» debe ser un número entero'),
      new BadRequestException(['El campo «name» debe ser un texto']),
    ]) {
      expect(routeErrorInSpanish(exception, req('GET', '/api/tickets/7'))).toBeNull();
    }
  });
});
