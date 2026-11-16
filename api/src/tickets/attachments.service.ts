import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { NO_FILE_MESSAGE } from '../common/uploads';
import { PrismaService } from '../prisma.service';
import { clearIncoming, originalName, removeFiles, uploadDir } from './attachment-files';
import type { TicketDetailDto } from './ticket-mappers';
import { activityStamp } from './ticket-update';
import { TicketsService } from './tickets.service';

/** The 404 of an attachment someone else removed meanwhile: the web shows it, and Nest's own text is English. */
export const ATTACHMENT_NOT_FOUND = 'El adjunto no existe';

/** The files attached to the cases: their rows, and the files themselves in the folder of the attachments (`uploadDir`). */
@Injectable()
export class AttachmentsService implements OnModuleInit {
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
  async upload(id: number, files: Express.Multer.File[] | undefined): Promise<TicketDetailDto> {
    if (!files?.length) throw new BadRequestException(NO_FILE_MESSAGE);
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

  /** The attachment, and where its file is. */
  async find(id: number): Promise<{ attachment: Attachment; path: string }> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException(ATTACHMENT_NOT_FOUND);
    return { attachment, path: join(uploadDir(), attachment.storedName) };
  }

  async remove(id: number): Promise<void> {
    const { path } = await this.find(id);
    await this.prisma.attachment.delete({ where: { id } });
    await unlink(path).catch(() => undefined);
  }
}
