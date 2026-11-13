import { ConflictException, Controller, Get, Param } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaExceptionFilter } from './prisma-exception.filter';

@Controller()
class FailingController {
  @Get('prisma/:code')
  prisma(@Param('code') code: string): never {
    throw new Prisma.PrismaClientKnownRequestError(`Prisma failed with ${code}`, { code, clientVersion: Prisma.prismaVersion.client });
  }

  @Get('http')
  http(): never {
    throw new ConflictException('Ya existe un usuario con ese nombre de usuario');
  }

  @Get('bug')
  bug(): never {
    throw new Error('not a Prisma error');
  }
}

/** Goes through a real Nest application: the body format is Nest's, not the filter's. */
describe('PrismaExceptionFilter', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FailingController],
      // Registered the same way as in AppModule.
      providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
    }).compile();
    // The two 500 cases below are logged by Nest; that output is not part of the test.
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['P2025', 404, { message: 'El registro no existe', error: 'Not Found', statusCode: 404 }],
    ['P2002', 409, { message: 'Ya existe un registro con esos datos', error: 'Conflict', statusCode: 409 }],
    [
      'P2003',
      400,
      { message: 'La operación hace referencia a un registro que no existe o que sigue en uso', error: 'Bad Request', statusCode: 400 },
    ],
    // A transaction out of time, as one that waited behind an import for the lock of a catalog.
    [
      'P2028',
      503,
      {
        message: 'El sistema está ocupado con otra operación y no se guardó nada. Intenta de nuevo en unos momentos.',
        error: 'Service Unavailable',
        statusCode: 503,
      },
    ],
  ])('answers Prisma error %s with HTTP %i and a message in Spanish', async (code, status, body) => {
    const response = await request(app.getHttpServer()).get(`/prisma/${code}`);
    expect(response.status).toBe(status);
    expect(response.body).toEqual(body);
  });

  it('leaves any other Prisma error as the 500 of Nest', async () => {
    const response = await request(app.getHttpServer()).get('/prisma/P2024');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  it('does not touch an HttpException thrown by the application', async () => {
    const response = await request(app.getHttpServer()).get('/http');
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ message: 'Ya existe un usuario con ese nombre de usuario', error: 'Conflict', statusCode: 409 });
  });

  it('does not touch errors that do not come from Prisma', async () => {
    const response = await request(app.getHttpServer()).get('/bug');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });
});
