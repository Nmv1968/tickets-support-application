import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { PrismaService } from '../prisma.service';
import { FILE_TYPES, datedFileName, download, refuseOverLimit } from './exports';

describe('the files the API makes', () => {
  it('are downloaded under their name, with the type their extension says', () => {
    const res = { set: jest.fn() };
    const file = Buffer.from('contenido');

    const xlsx = download(res as unknown as Response, file, 'plantilla-casos-soporte.xlsx');
    download(res as unknown as Response, file, 'reporte-soporte-2026-11-14.pdf');

    expect(xlsx).toBeInstanceOf(StreamableFile);
    expect(res.set.mock.calls).toEqual([
      [{ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="plantilla-casos-soporte.xlsx"' }],
      [{ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="reporte-soporte-2026-11-14.pdf"' }],
    ]);
    expect(Object.keys(FILE_TYPES)).toEqual(['xlsx', 'pdf']);
  });

  it('are named after the day they are made, on the clock of the server', () => {
    expect(datedFileName('casos-soporte', 'xlsx', new Date(2026, 10, 14, 23, 59))).toBe('casos-soporte-2026-11-14.xlsx');
    expect(datedFileName('reporte-soporte', 'pdf', new Date(2026, 0, 2, 0, 1))).toBe('reporte-soporte-2026-01-02.pdf');
  });

  describe('with a limit of cases', () => {
    const counting = (total: number) => ({ ticket: { count: jest.fn().mockResolvedValue(total), findMany: jest.fn() } });
    const where = { archivedAt: null };
    const refusal = (total: number): string => `Son ${total} casos`;

    it('lets through as many cases as the limit, counting them once', async () => {
      const db = counting(20);

      await expect(refuseOverLimit(db as unknown as PrismaService, where, 20, refusal)).resolves.toBeUndefined();
      expect(db.ticket.count).toHaveBeenCalledTimes(1);
      expect(db.ticket.count).toHaveBeenCalledWith({ where });
    });

    it('refuses one more with the 400 of the file, which says how many there are, and loads none', async () => {
      const db = counting(21);

      await expect(refuseOverLimit(db as unknown as PrismaService, where, 20, refusal)).rejects.toEqual(new BadRequestException('Son 21 casos'));
      expect(db.ticket.findMany).not.toHaveBeenCalled();
    });
  });
});
