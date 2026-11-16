import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { IdPipe } from '../common/id.pipe';
import { FEW_FIELDS, uploadErrors } from '../common/uploads';
import { attachmentStorage } from './attachment-files';
import { AttachmentsService } from './attachments.service';
import type { TicketDetailDto } from './ticket-mappers';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 10;
/** What one upload may carry. The largest request of the API: nginx admits it and little more (web/nginx.conf). */
const UPLOAD_LIMITS = { fileSize: MAX_FILE_BYTES, files: MAX_FILES, ...FEW_FIELDS };

@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** The files go to disk as they arrive (`attachmentStorage`), and into place with their rows (`AttachmentsService.upload`). */
  @Post('tickets/:id/attachments')
  @UseInterceptors(uploadErrors(UPLOAD_LIMITS), FilesInterceptor('files', MAX_FILES, { storage: attachmentStorage, limits: UPLOAD_LIMITS }))
  upload(@Param('id', IdPipe) id: number, @UploadedFiles() files: Express.Multer.File[] | undefined): Promise<TicketDetailDto> {
    return this.attachments.upload(id, files);
  }

  @Get('attachments/:id')
  async download(@Param('id', IdPipe) id: number, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { attachment, path } = await this.attachments.find(id);
    res.set({
      'Content-Type': attachment.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(createReadStream(path));
  }

  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', IdPipe) id: number): Promise<void> {
    return this.attachments.remove(id);
  }
}
