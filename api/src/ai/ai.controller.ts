import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UnprocessableEntityException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { IdPipe } from '../common/id.pipe';
import { TicketsService } from '../tickets/tickets.service';
import type { TicketDetailDto } from '../tickets/tickets.service';
import { AiService } from './ai.service';
import type { ProviderConfigDto, TicketDraft } from './ai.service';
import { AiError, isProviderId } from './types';
import type { AiModelInfo, ProviderId } from './types';

class SaveConfigDto {
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(300) baseUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(200) model?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ModelsDto {
  @IsString() provider!: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(300) baseUrl?: string | null;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function providerId(value: string): ProviderId {
  if (!isProviderId(value)) throw new BadRequestException('Proveedor de IA desconocido');
  return value;
}

/** Provider problems reach the user as HTTP 422 with a readable message. */
async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AiError) throw new UnprocessableEntityException(error.message);
    throw error;
  }
}

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly tickets: TicketsService,
  ) {}

  @Get('config')
  config(): Promise<ProviderConfigDto[]> {
    return this.ai.config();
  }

  @Put('config/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Param('provider') provider: string, @Body() dto: SaveConfigDto): Promise<void> {
    return this.ai.save(providerId(provider), dto);
  }

  @Post('models')
  @HttpCode(HttpStatus.OK)
  models(@Body() dto: ModelsDto): Promise<AiModelInfo[]> {
    return run(() => this.ai.models(providerId(dto.provider), { apiKey: dto.apiKey, baseUrl: dto.baseUrl }));
  }

  @Post('test/:provider')
  @HttpCode(HttpStatus.OK)
  test(@Param('provider') provider: string): Promise<{ ok: boolean; message: string; ms: number }> {
    return run(() => this.ai.test(providerId(provider)));
  }

  /** Drafts the message for the client of one case and returns the updated case. */
  @Post('reply/:ticketId')
  @HttpCode(HttpStatus.OK)
  async reply(@Param('ticketId', IdPipe) ticketId: number): Promise<TicketDetailDto> {
    await run(() => this.ai.reply(ticketId));
    return this.tickets.get(ticketId);
  }

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('images', 4, { limits: { fileSize: MAX_IMAGE_BYTES } }))
  analyze(@UploadedFiles() files: Express.Multer.File[] | undefined, @Body('text') text?: unknown): Promise<TicketDraft> {
    const images = files ?? [];
    // Nothing checks a single value of the body before it gets here: a form field sent twice
    // arrives as an array, and a JSON body can carry a number or an object.
    if (text !== undefined && typeof text !== 'string') throw new BadRequestException('El campo "text" no es válido. Debe ser un solo texto.');
    const cleanText = (text ?? '').trim().slice(0, 8000);
    if (!images.length && !cleanText) throw new BadRequestException('Envía una imagen o un texto');
    if (images.some((file) => !IMAGE_TYPES.includes(file.mimetype))) {
      throw new BadRequestException('Solo se aceptan imágenes JPG, PNG, WEBP o GIF');
    }
    return run(() =>
      this.ai.analyze(
        cleanText,
        images.map((file) => ({ mime: file.mimetype, base64: file.buffer.toString('base64') })),
      ),
    );
  }
}
