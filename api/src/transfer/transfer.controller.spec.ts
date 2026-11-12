import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { formatDateOnly, todayDateOnly } from '../common/labels';
import { TransferController } from './transfer.controller';
import type { TransferService } from './transfer.service';

// The controller imports the login decorators and, through them, @nestjs/jwt, which is published
// as ES modules only: Jest cannot load it here. Nothing in these endpoints uses it.
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));

describe('export endpoints', () => {
  const formats = [
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['pdf', 'application/pdf'],
  ] as const;

  /** The controller over a fake service whose export answers, or fails, as the test says. */
  const setup = (exportFile: jest.Mock): { controller: TransferController; res: { set: jest.Mock } } => ({
    controller: new TransferController({ xlsx: exportFile, pdf: exportFile } as unknown as TransferService),
    res: { set: jest.fn() },
  });

  it.each(formats)('%s: hands the service the filters of the query string, read as the list reads them', async (format) => {
    const exportFile = jest.fn().mockResolvedValue(Buffer.from('file'));
    const { controller, res } = setup(exportFile);

    // A repeated parameter arrives as an array, and one the list does not know is left out: neither is an error.
    const query = { status: ['PENDING', 'RESOLVED'], moduleId: '4', from: '2026-02-01', to: '2026-02-28', other: 'x' };
    await controller[format](query, res as unknown as Response);

    expect(exportFile).toHaveBeenCalledWith({ status: ['PENDING', 'RESOLVED'], moduleId: 4, from: '2026-02-01', to: '2026-02-28' });
  });

  // Exported without that end of the range, the file would hold cases the person did not ask for.
  it.each(formats)('%s: refuses a day that does not exist in the range, and exports nothing', async (format) => {
    const exportFile = jest.fn().mockResolvedValue(Buffer.from('file'));
    const { controller, res } = setup(exportFile);

    for (const query of [{ from: '2026-02-30' }, { from: '2026-02-01', to: '2026-13-45' }, { to: 'ayer' }]) {
      await expect(controller[format](query, res as unknown as Response)).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(exportFile).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
  });

  it.each(formats)('%s: answers with the file and its headers', async (format, type) => {
    const { controller, res } = setup(jest.fn().mockResolvedValue(Buffer.from('file')));

    expect(await controller[format]({}, res as unknown as Response)).toBeInstanceOf(StreamableFile);

    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="casos-soporte-${formatDateOnly(todayDateOnly())}.${format}"`,
    });
  });

  it.each(formats)('%s: answers a refused export with the error alone, without the headers of a file', async (format) => {
    const refusal = new BadRequestException('Acota los filtros');
    const { controller, res } = setup(jest.fn().mockRejectedValue(refusal));

    await expect(controller[format]({}, res as unknown as Response)).rejects.toBe(refusal);

    expect(res.set).not.toHaveBeenCalled();
  });
});

describe('import template endpoint', () => {
  it('answers with the spreadsheet as a file to download', async () => {
    const template = jest.fn().mockResolvedValue(Buffer.from('file'));
    const controller = new TransferController({ template } as unknown as TransferService);
    const res = { set: jest.fn() };

    expect(await controller.template(res as unknown as Response)).toBeInstanceOf(StreamableFile);

    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-casos-soporte.xlsx"',
    });
  });
});
