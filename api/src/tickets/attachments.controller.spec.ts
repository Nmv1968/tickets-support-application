import { BadRequestException } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import type { PrismaService } from '../prisma.service';
import { AttachmentsController } from './attachments.controller';
import type { TicketsService } from './tickets.service';

// Nothing is written to disk: the upload only has to ask for it.
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const NOW = new Date(2026, 10, 11, 10, 0, 0);

describe('attachment upload', () => {
  /** The controller over a fake database that holds case 7 and records what is written to it. */
  const setup = () => {
    const db = { attachment: { create: jest.fn().mockResolvedValue({}) }, ticket: { update: jest.fn().mockResolvedValue({}) } };
    const tickets = { get: jest.fn().mockResolvedValue({ id: 7 }) };
    return { db, controller: new AttachmentsController(db as unknown as PrismaService, tickets as unknown as TicketsService) };
  };
  const file = (originalname: string): Express.Multer.File => ({ originalname, buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 }) as Express.Multer.File;

  beforeAll(() => jest.useFakeTimers({ now: NOW }));
  afterAll(() => jest.useRealTimers());
  beforeEach(() => jest.clearAllMocks());

  it('stores each file and counts as activity on the case', async () => {
    const { db, controller } = setup();

    await controller.upload(7, [file('error.PNG'), file('chat.png')]);

    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(db.attachment.create.mock.calls).toMatchObject([
      [{ data: { ticketId: 7, filename: 'error.PNG', mime: 'image/png', size: 1 } }],
      [{ data: { ticketId: 7, filename: 'chat.png', mime: 'image/png', size: 1 } }],
    ]);
    // Without this the case would still show as forgotten after someone attached evidence to it.
    expect(db.ticket.update).toHaveBeenCalledTimes(1);
    expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { lastActivityAt: NOW } });
  });

  it('refuses an upload without files and leaves the case as it was', async () => {
    const { db, controller } = setup();

    await expect(controller.upload(7, [])).rejects.toBeInstanceOf(BadRequestException);

    expect(writeFile).not.toHaveBeenCalled();
    expect(db.ticket.update).not.toHaveBeenCalled();
  });
});
