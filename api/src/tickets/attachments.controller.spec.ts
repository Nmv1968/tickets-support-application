import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { configureApp } from '../app.setup';
import { MB } from '../common/uploads';
import { PrismaService } from '../prisma.service';
import { incomingDir, storedName } from './attachment-files';
import { AttachmentsController } from './attachments.controller';
import { TicketsService } from './tickets.service';

const NOW = new Date(2026, 10, 11, 10, 0, 0);

/** The attachments folder of each test: a new empty one, given to the API as UPLOAD_DIR. */
let root: string;
const savedUploadDir = process.env.UPLOAD_DIR;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'soporte-adjuntos-'));
  process.env.UPLOAD_DIR = root;
});
afterEach(async () => {
  if (savedUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = savedUploadDir;
  await rm(root, { recursive: true, force: true });
});

/** The files in the folder of the attachments, and in the one of the uploads in progress. */
async function onDisk(): Promise<{ stored: string[]; incoming: string[] }> {
  const entries = await readdir(root, { withFileTypes: true });
  const incoming = await readdir(incomingDir()).catch(() => []);
  return { stored: entries.filter((entry) => entry.isFile()).map((entry) => entry.name), incoming };
}

/** The message of an error answer of the API. */
const said = (answer: request.Response): string => (answer.body as { message: string }).message;

/** A fake database that holds case 7 and records what is written to it. */
function database() {
  const db = {
    $transaction: jest.fn((writes: Promise<unknown>[]) => Promise.all(writes)),
    attachment: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ticket: { update: jest.fn().mockResolvedValue({}) },
  };
  return db;
}

describe('attachment upload', () => {
  /** The controller over the fake database, with case 7 in it. */
  const setup = () => {
    const db = database();
    const tickets = { get: jest.fn().mockResolvedValue({ id: 7 }) };
    return { db, tickets, controller: new AttachmentsController(db as unknown as PrismaService, tickets as unknown as TicketsService) };
  };
  /** A file as multer leaves it: written under its stored name in the folder of uploads in progress. */
  const arrived = async (originalname: string, content = 'x'): Promise<Express.Multer.File> => {
    await mkdir(incomingDir(), { recursive: true });
    const filename = storedName(originalname);
    const path = join(incomingDir(), filename);
    await writeFile(path, content);
    return { originalname, filename, path, mimetype: 'image/png', size: content.length } as Express.Multer.File;
  };

  beforeAll(() => jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'nextTick'] }));
  afterAll(() => jest.useRealTimers());

  it('moves each file into the folder of the attachments and stores their rows with the activity of the case, in one transaction', async () => {
    const { db, controller } = setup();
    const files = [await arrived('error.PNG', 'uno'), await arrived('chat.png', 'dos')];

    await controller.upload(7, files);

    const disk = await onDisk();
    expect(disk.incoming).toEqual([]);
    expect(disk.stored.sort()).toEqual(files.map((file) => file.filename).sort());
    expect(await readFile(join(root, files[0].filename), 'utf8')).toBe('uno');
    expect(files[0].filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.attachment.createMany).toHaveBeenCalledWith({
      data: [
        { ticketId: 7, filename: 'error.PNG', storedName: files[0].filename, mime: 'image/png', size: 3 },
        { ticketId: 7, filename: 'chat.png', storedName: files[1].filename, mime: 'image/png', size: 3 },
      ],
    });
    // Without this the case would still show as forgotten after someone attached evidence to it.
    expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { lastActivityAt: NOW } });
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('keeps the name the file had, sent in UTF-8 and read by multer as latin1', async () => {
    const { db, controller } = setup();

    await controller.upload(7, [await arrived(Buffer.from('cotización ñandú.pdf', 'utf8').toString('latin1'))]);

    expect(db.attachment.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ filename: 'cotización ñandú.pdf' })] });
  });

  it('refuses an upload without files and leaves the case as it was', async () => {
    const { db, controller } = setup();

    await expect(controller.upload(7, [])).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.upload(7, undefined)).rejects.toBeInstanceOf(BadRequestException);

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('removes the files of a case that does not exist, and stores nothing', async () => {
    const { db, tickets, controller } = setup();
    tickets.get.mockRejectedValue(new NotFoundException('El caso no existe'));

    await expect(controller.upload(7, [await arrived('error.png'), await arrived('chat.png')])).rejects.toThrow('El caso no existe');

    expect(await onDisk()).toEqual({ stored: [], incoming: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  // Before, each file was written and then its row, one by one: a failure left files nobody
  // could see or delete, and part of the upload on the case.
  it('removes the files when their rows cannot be written, those already moved into place included', async () => {
    const { db, controller } = setup();
    db.$transaction.mockRejectedValue(new Error('connection lost'));

    await expect(controller.upload(7, [await arrived('error.png'), await arrived('chat.png')])).rejects.toThrow('connection lost');

    expect(await onDisk()).toEqual({ stored: [], incoming: [] });
  });

  it('removes them too when a file cannot be moved, and stores no row', async () => {
    const { db, controller } = setup();
    const files = [await arrived('error.png'), await arrived('chat.png')];
    await rm(files[1].path);

    await expect(controller.upload(7, files)).rejects.toThrow(/ENOENT/);

    expect(await onDisk()).toEqual({ stored: [], incoming: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('empties the folder of uploads in progress when the API starts, and leaves the attachments', async () => {
    const { controller } = setup();
    await arrived('a medias.png');
    await writeFile(join(root, 'adjunto.png'), 'x');

    await controller.onModuleInit();

    expect(await onDisk()).toEqual({ stored: ['adjunto.png'], incoming: [] });
    await expect(controller.onModuleInit()).resolves.toBeUndefined();
  });
});

/** An attachment someone else removed while the case was on screen: the web shows the message of the 404. */
describe('an attachment that does not exist', () => {
  const setup = () => {
    const db = { attachment: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() } };
    return { db, controller: new AttachmentsController(db as unknown as PrismaService, {} as TicketsService) };
  };

  it('answers its download with a 404 in Spanish', async () => {
    await expect(setup().controller.download(5, {} as never)).rejects.toThrow(new NotFoundException('El adjunto no existe'));
  });

  it('answers its removal with a 404 in Spanish, and deletes nothing', async () => {
    const { db, controller } = setup();

    await expect(controller.remove(5)).rejects.toThrow(new NotFoundException('El adjunto no existe'));
    expect(db.attachment.delete).not.toHaveBeenCalled();
  });
});

/**
 * The route as the API serves it, multer included: the files go to disk as they arrive, and a
 * request that is refused, by a limit or by a pipe, leaves nothing behind.
 */
describe('attachment upload through multer', () => {
  let app: INestApplication;
  let db: ReturnType<typeof database>;
  const tickets = { get: jest.fn().mockResolvedValue({ id: 7, attachments: [] }) };

  beforeEach(async () => {
    db = database();
    const moduleRef = await Test.createTestingModule({
      controllers: [AttachmentsController],
      providers: [
        { provide: PrismaService, useValue: db },
        { provide: TicketsService, useValue: tickets },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app as NestExpressApplication, {});
    await app.init();
  });
  afterEach(() => app.close());

  const upload = (id: number | string = 7) => request(app.getHttpServer()).post(`/api/tickets/${id}/attachments`);
  /** Nest removes the files of a request a pipe refused once the answer is out: shortly after it arrives here. */
  const settled = async (): Promise<{ stored: string[]; incoming: string[] }> => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const disk = await onDisk();
      if (!disk.incoming.length) return disk;
      await new Promise((done) => setTimeout(done, 20));
    }
    return onDisk();
  };

  it('writes the files to disk as they arrive and moves them into place', async () => {
    const answer = await upload()
      .attach('files', Buffer.from('uno'), { filename: 'error.png', contentType: 'image/png' })
      .attach('files', Buffer.alloc(MB, 'b'), { filename: 'registro.txt', contentType: 'text/plain' });

    expect(answer.status).toBe(201);
    const [rows] = db.attachment.createMany.mock.calls[0] as [{ data: { storedName: string; mime: string; size: number }[] }];
    expect(rows.data.map(({ mime, size }) => ({ mime, size }))).toEqual([
      { mime: 'image/png', size: 3 },
      { mime: 'text/plain', size: MB },
    ]);
    const disk = await onDisk();
    expect(disk.incoming).toEqual([]);
    expect(disk.stored.sort()).toEqual(rows.data.map((row) => row.storedName).sort());
    expect((await readFile(join(root, rows.data[1].storedName))).length).toBe(MB);
  });

  it('refuses a file over 15 MB in Spanish and leaves nothing on disk, not even the files before it', async () => {
    const answer = await upload()
      .attach('files', Buffer.from('uno'), 'error.png')
      .attach('files', Buffer.alloc(15 * MB + 1), 'video.mp4');

    expect(answer.status).toBe(413);
    expect(said(answer)).toBe('Cada archivo puede pesar hasta 15 MB.');
    expect(await settled()).toEqual({ stored: [], incoming: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('takes a file of exactly 15 MB', async () => {
    await upload().attach('files', Buffer.alloc(15 * MB), 'video.mp4').expect(201);

    expect((await onDisk()).stored).toHaveLength(1);
  });

  it('refuses more than 10 files in Spanish, and a field of text longer than the form admits', async () => {
    const eleven = upload();
    for (let index = 0; index < 11; index++) void eleven.attach('files', Buffer.from('x'), `foto${index}.png`);
    const tooMany = await eleven;
    expect(tooMany.status).toBe(400);
    expect(said(tooMany)).toBe('Se pueden enviar hasta 10 archivos a la vez.');

    const longField = await upload().field('nota', 'x'.repeat(2000)).attach('files', Buffer.from('x'), 'foto.png');
    expect(longField.status).toBe(400);
    expect(said(longField)).toBe('Los campos de texto que acompañan a los archivos superan lo que se admite.');

    expect(await settled()).toEqual({ stored: [], incoming: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('leaves nothing on disk when the id of the case is refused before the upload is handled', async () => {
    const answer = await upload('abc').attach('files', Buffer.from('uno'), 'error.png');

    expect(answer.status).toBe(400);
    expect(await settled()).toEqual({ stored: [], incoming: [] });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a form cut short in Spanish, and leaves nothing on disk', async () => {
    const answer = await upload()
      .set('Content-Type', 'multipart/form-data; boundary=limite')
      .send('--limite\r\nContent-Disposition: form-data; name="files"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nmedio archivo');

    expect(answer.status).toBe(400);
    expect(said(answer)).toBe('Los archivos llegaron incompletos o mal formados. Vuelve a enviarlos.');
    expect(await settled()).toEqual({ stored: [], incoming: [] });
  });
});
