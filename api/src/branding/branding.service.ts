import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma.service';

/** The logo is shown small (menu, login, browser tab); the web shrinks it before sending it. */
export const LOGO_MAX_BYTES = 512 * 1024;

const KEY = 'logo';

/**
 * Image formats accepted for the logo, told by the first bytes of the file and not by the name or
 * the type the browser declares. SVG is left out on purpose: it can carry scripts, and the logo is
 * served to everyone, also to people who have not logged in.
 */
const FORMATS: { mime: string; matches: (file: Buffer) => boolean }[] = [
  { mime: 'image/png', matches: (file) => file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', matches: (file) => file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff },
  { mime: 'image/webp', matches: (file) => file.subarray(0, 4).toString('latin1') === 'RIFF' && file.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/** The image type of `file`, or null when it is not one of the accepted formats. */
export function imageType(file: Buffer): string | null {
  return FORMATS.find((format) => format.matches(file))?.mime ?? null;
}

export interface Logo {
  mime: string;
  data: Buffer;
  /** Changes with the image. The web puts it in the address of the logo, so browsers can keep each one for good. */
  version: string;
}

interface StoredLogo {
  mime: string;
  version: string;
  /** The image, base64. */
  data: string;
}

/**
 * The look an installation gives itself: for now, the company logo that takes the place of the
 * default icon. It lives in the settings table, so it travels with the database and its backups.
 */
@Injectable()
export class BrandingService {
  /** Read on every page load of every visitor, so it is kept in memory. `undefined`: not read yet. */
  private cached: Logo | null | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async logo(): Promise<Logo | null> {
    if (this.cached !== undefined) return this.cached;
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    this.cached = row ? read(row.value) : null;
    return this.cached;
  }

  async setLogo(file: Buffer): Promise<Logo> {
    const mime = imageType(file);
    if (!mime) throw new BadRequestException('El logo debe ser una imagen PNG, JPG o WebP.');
    if (file.length > LOGO_MAX_BYTES) {
      throw new BadRequestException(`El logo no puede pesar más de ${LOGO_MAX_BYTES / 1024} KB. Usa una imagen más pequeña.`);
    }
    const logo: Logo = { mime, data: file, version: createHash('sha256').update(file).digest('hex').slice(0, 16) };
    const value = JSON.stringify({ mime, version: logo.version, data: file.toString('base64') } satisfies StoredLogo);
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    this.cached = logo;
    return logo;
  }

  async removeLogo(): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { key: KEY } });
    this.cached = null;
  }
}

/** A stored value that cannot be read counts as no logo: the default icon shows instead of an error. */
function read(value: string): Logo | null {
  try {
    const stored = JSON.parse(value) as Partial<StoredLogo>;
    if (typeof stored.mime !== 'string' || typeof stored.version !== 'string' || typeof stored.data !== 'string') return null;
    return { mime: stored.mime, version: stored.version, data: Buffer.from(stored.data, 'base64') };
  } catch {
    return null;
  }
}
