import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { IdPipe } from '../common/id.pipe';
import { PrismaService } from '../prisma.service';
import { TicketsService, activityStamp, uploadDir } from './tickets.service';
import type { TicketDetailDto } from './tickets.service';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

@Controller()
export class AttachmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  @Post('tickets/:id/attachments')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_FILE_BYTES } }))
  async upload(
    @Param('id', IdPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<TicketDetailDto> {
    if (!files?.length) throw new BadRequestException('No se recibió ningún archivo');
    await this.tickets.get(id);
    await mkdir(uploadDir(), { recursive: true });

    for (const file of files) {
      // multer decodes multipart file names as latin1; browsers send UTF-8.
      const filename = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
      const storedName = `${randomUUID()}${extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '')}`;
      await writeFile(join(uploadDir(), storedName), file.buffer);
      await this.prisma.attachment.create({
        data: { ticketId: id, filename, storedName, mime: file.mimetype || 'application/octet-stream', size: file.size },
      });
    }
    // New attachments are activity on the case: it stops being forgotten.
    await this.prisma.ticket.update({ where: { id }, data: activityStamp() });
    return this.tickets.get(id);
  }

  @Get('attachments/:id')
  async download(
    @Param('id', IdPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException();
    res.set({
      'Content-Type': attachment.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(createReadStream(join(uploadDir(), attachment.storedName)));
  }

  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', IdPipe) id: number): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException();
    await this.prisma.attachment.delete({ where: { id } });
    await unlink(join(uploadDir(), attachment.storedName)).catch(() => undefined);
  }
}
