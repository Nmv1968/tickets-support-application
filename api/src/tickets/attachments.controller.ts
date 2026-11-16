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
import type { OnModuleInit } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { IdPipe } from '../common/id.pipe';
import { FEW_FIELDS, uploadErrors } from '../common/uploads';
import { PrismaService } from '../prisma.service';
import { attachmentStorage, clearIncoming, originalName, removeFiles } from './attachment-files';
import { TicketsService, activityStamp, uploadDir } from './tickets.service';
import type { TicketDetailDto } from './tickets.service';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 10;
/** What one upload may carry. The largest request of the API: nginx admits it and little more (web/nginx.conf). */
const UPLOAD_LIMITS = { fileSize: MAX_FILE_BYTES, files: MAX_FILES, ...FEW_FIELDS };
/** The 404 of an attachment someone else removed meanwhile: the web shows it, and Nest's own text is English. */
export const ATTACHMENT_NOT_FOUND = 'El adjunto no existe';

@Controller()
export class AttachmentsController implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await clearIncoming();
  }

  /**
   * The files arrive on disk, in the folder of uploads in progress (`attachmentStorage`). Only once
   * the case is known to exist are they moved into the folder of the attachments, and their rows
   * are written in one transaction with the activity of the case: all of them or none. If anything
   * fails on the way, the files of this request are removed, wherever they are by then; Nest
   * removes them too when a pipe refuses the request before it gets here (an id that is no number).
   */
  @Post('tickets/:id/attachments')
  @UseInterceptors(uploadErrors(UPLOAD_LIMITS), FilesInterceptor('files', MAX_FILES, { storage: attachmentStorage, limits: UPLOAD_LIMITS }))
  async upload(
    @Param('id', IdPipe) id: number,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<TicketDetailDto> {
    if (!files?.length) throw new BadRequestException('No se recibió ningún archivo');
    const placed = files.map((file) => join(uploadDir(), file.filename));
    try {
      await this.tickets.get(id);
      for (const [index, file] of files.entries()) await rename(file.path, placed[index]);
      await this.prisma.$transaction([
        this.prisma.attachment.createMany({
          data: files.map((file) => ({
            ticketId: id,
            filename: originalName(file),
            storedName: file.filename,
            mime: file.mimetype || 'application/octet-stream',
            size: file.size,
          })),
        }),
        // New attachments are activity on the case: it stops being forgotten.
        this.prisma.ticket.update({ where: { id }, data: activityStamp() }),
      ]);
    } catch (error) {
      await removeFiles([...files.map((file) => file.path), ...placed]);
      throw error;
    }
    return this.tickets.get(id);
  }

  @Get('attachments/:id')
  async download(
    @Param('id', IdPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);
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
    if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);
    await this.prisma.attachment.delete({ where: { id } });
    await unlink(join(uploadDir(), attachment.storedName)).catch(() => undefined);
  }
}
