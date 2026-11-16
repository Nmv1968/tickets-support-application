import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AiController } from '../ai/ai.controller';
import { AiService } from '../ai/ai.service';
import { configureApp } from '../app.setup';
import { BrandingController } from '../branding/branding.controller';
import { BrandingService } from '../branding/branding.service';
import { TicketsService } from '../tickets/tickets.service';
import { TransferController } from '../transfer/transfer.controller';
import { TransferService } from '../transfer/transfer.service';
import { FEW_FIELDS, MB, megabytes, uploadError } from './uploads';

/** The message of an error answer of the API. */
const said = (answer: request.Response): string => (answer.body as { message: string }).message;

describe('the errors of an upload, in Spanish', () => {
  const several = { fileSize: 15 * MB, files: 10 };
  const one = { fileSize: 20 * MB, files: 1 };
  const message = (error: unknown): string => (error as Error).message;

  it('names the size each file may have, and how many go at once', () => {
    expect(megabytes(15 * MB)).toBe('15');
    expect(uploadError(new PayloadTooLargeException('File too large'), several)).toEqual(new PayloadTooLargeException('Cada archivo puede pesar hasta 15 MB.'));
    expect(uploadError(new PayloadTooLargeException('File too large'), one)).toEqual(new PayloadTooLargeException('El archivo puede pesar hasta 20 MB.'));
    expect(uploadError(new BadRequestException('Too many files'), several)).toEqual(new BadRequestException('Se pueden enviar hasta 10 archivos a la vez.'));
    expect(uploadError(new BadRequestException('Too many files'), one)).toEqual(new BadRequestException('Se puede enviar un solo archivo a la vez.'));
  });

  it('says which field a file came in when it was not the one expected', () => {
    expect(message(uploadError(new BadRequestException('Unexpected file field - otro'), several))).toBe('Un archivo llegó en un campo que no se esperaba: "otro".');
    expect(message(uploadError(new BadRequestException('Unexpected file field'), several))).toBe('Un archivo llegó en un campo que no se esperaba.');
  });

  it('says the same of every limit of the fields of text, and of a form that came broken', () => {
    for (const english of ['Too many fields', 'Field value too long - nota', 'Too many parts', 'Field name too long']) {
      expect(message(uploadError(new BadRequestException(english), several))).toBe('Los campos de texto que acompañan a los archivos superan lo que se admite.');
    }
    expect(message(uploadError(new BadRequestException('Multipart: Unexpected end of form'), several))).toBe('Los archivos llegaron incompletos o mal formados. Vuelve a enviarlos.');
  });

  // The route throws its own errors, already in Spanish, and some of the same classes.
  it('leaves every other error as it came', () => {
    const errors = [
      new PayloadTooLargeException('El logo no puede pesar más de 512 KB.'),
      new BadRequestException('No se recibió ningún archivo'),
      new NotFoundException('El caso no existe'),
      new Error('File too large'),
      'File too large',
    ];
    for (const error of errors) expect(uploadError(error, several)).toBe(error);
  });
});

/**
 * The upload routes that keep the file in memory, over fakes of their services: the limits are
 * those of the routes, and the messages are what multer really says, through Nest, put in Spanish.
 */
describe('the upload routes that keep the file in memory', () => {
  let app: INestApplication;
  const transfer = { import: jest.fn().mockResolvedValue({ toCreate: 0 }) };
  const ai = { analyze: jest.fn().mockResolvedValue({ description: 'Borrador' }) };
  const branding = { setLogo: jest.fn().mockResolvedValue({ version: 'v1' }) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransferController, AiController, BrandingController],
      providers: [
        { provide: TransferService, useValue: transfer },
        { provide: AiService, useValue: ai },
        { provide: TicketsService, useValue: {} },
        { provide: BrandingService, useValue: branding },
        // In place of the login check: an import is made in the name of whoever is logged in.
        { provide: APP_GUARD, useValue: { canActivate: (context: ExecutionContext) => !!Object.assign(context.switchToHttp().getRequest(), { user: { id: 1 } }) } satisfies CanActivate },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app as NestExpressApplication, {});
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const bytes = (size: number): Buffer => Buffer.alloc(size, 'a');

  it('takes a sheet of up to 20 MB and refuses a larger one in Spanish, without reading it', async () => {
    await request(app.getHttpServer()).post('/api/import').attach('file', bytes(20 * MB), 'casos.csv').expect(200);
    expect(transfer.import).toHaveBeenCalledTimes(1);

    const answer = await request(app.getHttpServer()).post('/api/import').attach('file', bytes(20 * MB + 1), 'casos.csv');

    expect(answer.status).toBe(413);
    expect(said(answer)).toBe('El archivo puede pesar hasta 20 MB.');
    expect(transfer.import).toHaveBeenCalledTimes(1);
  });

  it('takes one sheet at a time, and short fields of text only', async () => {
    const twoFiles = await request(app.getHttpServer()).post('/api/import').attach('file', bytes(10), 'a.csv').attach('file', bytes(10), 'b.csv');
    expect(twoFiles.status).toBe(400);
    expect(said(twoFiles)).toBe('Se puede enviar un solo archivo a la vez.');

    const longField = await request(app.getHttpServer())
      .post('/api/import')
      .field('nota', 'x'.repeat(FEW_FIELDS.fieldSize + 1))
      .attach('file', bytes(10), 'a.csv');
    expect(longField.status).toBe(400);
    expect(said(longField)).toBe('Los campos de texto que acompañan a los archivos superan lo que se admite.');

    const manyFields = request(app.getHttpServer()).post('/api/import');
    for (let index = 0; index <= FEW_FIELDS.fields; index++) void manyFields.field(`campo${index}`, 'x');
    const tooMany = await manyFields.attach('file', bytes(10), 'a.csv');
    expect(tooMany.status).toBe(400);
    expect(said(tooMany)).toBe('Los campos de texto que acompañan a los archivos superan lo que se admite.');

    const otherField = await request(app.getHttpServer()).post('/api/import').attach('hoja', bytes(10), 'a.csv');
    expect(otherField.status).toBe(400);
    expect(said(otherField)).toBe('Un archivo llegó en un campo que no se esperaba: "hoja".');
    expect(transfer.import).not.toHaveBeenCalled();
  });

  it('takes up to 4 images of 8 MB for the AI, and a text of up to 1 MB with them', async () => {
    const png = { contentType: 'image/png', filename: 'captura.png' };
    const five = request(app.getHttpServer()).post('/api/ai/analyze');
    for (let index = 0; index < 5; index++) void five.attach('images', bytes(10), png);
    const tooMany = await five;
    expect(tooMany.status).toBe(400);
    expect(said(tooMany)).toBe('Se pueden enviar hasta 4 archivos a la vez.');

    const large = await request(app.getHttpServer()).post('/api/ai/analyze').attach('images', bytes(8 * MB + 1), png);
    expect(large.status).toBe(413);
    expect(said(large)).toBe('Cada archivo puede pesar hasta 8 MB.');

    // A long chat pasted whole: the AI gets its start (8000 characters), as before.
    await request(app.getHttpServer()).post('/api/ai/analyze').field('text', 'x'.repeat(MB)).attach('images', bytes(10), png).expect(200);
    expect(ai.analyze).toHaveBeenCalledWith('x'.repeat(8000), [expect.objectContaining({ mime: 'image/png' })]);
    const longer = await request(app.getHttpServer()).post('/api/ai/analyze').field('text', 'x'.repeat(MB + 1));
    expect(longer.status).toBe(400);
    expect(said(longer)).toBe('Los campos de texto que acompañan a los archivos superan lo que se admite.');
    // Each field may be that long, so they are few.
    const manyFields = request(app.getHttpServer()).post('/api/ai/analyze');
    for (let index = 0; index <= FEW_FIELDS.fields; index++) void manyFields.field('text', 'x');
    expect(said(await manyFields)).toBe('Los campos de texto que acompañan a los archivos superan lo que se admite.');
    expect(ai.analyze).toHaveBeenCalledTimes(1);
  });

  it('refuses a logo over 8 MB in Spanish before the service sees it', async () => {
    const answer = await request(app.getHttpServer()).put('/api/branding/logo').attach('file', bytes(8 * MB + 1), 'logo.png');

    expect(answer.status).toBe(413);
    expect(said(answer)).toBe('El archivo puede pesar hasta 8 MB.');
    expect(branding.setLogo).not.toHaveBeenCalled();
  });
});
