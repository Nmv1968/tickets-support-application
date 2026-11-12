import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public } from '../common/auth';
import { BrandingService } from './branding.service';

/**
 * Hard stop for the upload itself, well above what the service accepts: a file between the two
 * gets the service's message in Spanish instead of the generic one of the upload library.
 */
const UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024;

@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** What the web needs before anyone logs in: whether there is a logo, and which one. */
  @Public()
  @Get()
  async info(): Promise<{ logoVersion: string | null }> {
    return { logoVersion: (await this.branding.logo())?.version ?? null };
  }

  /**
   * The logo itself. Public: the login page and the browser tab icon ask for it without a session.
   * The web asks with the version in the address, so a browser may keep the answer for good; a new
   * logo has a new address.
   */
  @Public()
  @Get('logo')
  async logo(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const logo = await this.branding.logo();
    if (!logo) throw new NotFoundException('No hay un logo configurado');
    res.set({
      'Content-Type': logo.mime,
      'Content-Length': String(logo.data.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      // The file came from a person: the browser must take it as the image it was checked to be.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    return new StreamableFile(logo.data);
  }

  @Put('logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }))
  async setLogo(@UploadedFile() file: Express.Multer.File | undefined): Promise<{ logoVersion: string }> {
    if (!file) throw new BadRequestException('No se recibió ninguna imagen');
    return { logoVersion: (await this.branding.setLogo(file.buffer)).version };
  }

  @Delete('logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeLogo(): Promise<void> {
    await this.branding.removeLogo();
  }
}
