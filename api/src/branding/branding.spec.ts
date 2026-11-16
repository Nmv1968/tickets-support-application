import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { PrismaService } from '../prisma.service';
import { BrandingController } from './branding.controller';
import { BrandingService, LOGO_MAX_BYTES, imageType } from './branding.service';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('datos de la imagen')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('datos')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.from('datos')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** The settings table, in memory. */
function database(): { prisma: PrismaService; rows: Map<string, string>; reads: () => number } {
  const rows = new Map<string, string>();
  let reads = 0;
  const setting = {
    findUnique: ({ where }: { where: { key: string } }) => {
      reads++;
      const value = rows.get(where.key);
      return Promise.resolve(value === undefined ? null : { key: where.key, value });
    },
    upsert: ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
      rows.set(where.key, rows.has(where.key) ? update.value : create.value);
      return Promise.resolve({});
    },
    deleteMany: ({ where }: { where: { key: string } }) => {
      rows.delete(where.key);
      return Promise.resolve({ count: 1 });
    },
  };
  return { prisma: { setting } as unknown as PrismaService, rows, reads: () => reads };
}

describe('imageType', () => {
  it('tells the accepted formats by the first bytes of the file', () => {
    expect(imageType(PNG)).toBe('image/png');
    expect(imageType(JPEG)).toBe('image/jpeg');
    expect(imageType(WEBP)).toBe('image/webp');
  });

  // An SVG can carry scripts, and the logo is served to people who have not logged in.
  it('accepts nothing else: not an SVG, not a page, not an empty file', () => {
    expect(imageType(SVG)).toBeNull();
    expect(imageType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(imageType(Buffer.from('GIF89a'))).toBeNull();
    expect(imageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('BrandingService', () => {
  it('has no logo until one is saved', async () => {
    expect(await new BrandingService(database().prisma).logo()).toBeNull();
  });

  it('stores the logo with its type and a version that changes with the image', async () => {
    const { prisma, rows } = database();
    const service = new BrandingService(prisma);

    const first = await service.setLogo(PNG);
    expect(first).toMatchObject({ mime: 'image/png', data: PNG });
    expect(first.version).toMatch(/^[0-9a-f]{16}$/);
    expect(await service.logo()).toEqual(first);
    // Stored in the settings table, so it travels with the database and its backups.
    expect(JSON.parse(rows.get('logo') ?? '{}')).toEqual({ mime: 'image/png', version: first.version, data: PNG.toString('base64') });

    const second = await service.setLogo(JPEG);
    expect(second.mime).toBe('image/jpeg');
    expect(second.version).not.toBe(first.version);
    // The same image again has the same version: browsers keep the copy they have.
    expect((await service.setLogo(PNG)).version).toBe(first.version);
  });

  it('reads a stored logo back after a restart', async () => {
    const { prisma } = database();
    const saved = await new BrandingService(prisma).setLogo(WEBP);

    expect(await new BrandingService(prisma).logo()).toEqual(saved);
  });

  it('reads the database once, not on every page load', async () => {
    const { prisma, reads } = database();
    const service = new BrandingService(prisma);
    await service.logo();
    await service.logo();
    await service.setLogo(PNG);
    await service.logo();

    expect(reads()).toBe(1);
  });

  it('refuses a file that is not an accepted image, whatever it is called, and keeps the logo it had', async () => {
    const { prisma } = database();
    const service = new BrandingService(prisma);
    const saved = await service.setLogo(PNG);

    await expect(service.setLogo(SVG)).rejects.toThrow(new BadRequestException('El logo debe ser una imagen PNG, JPG o WebP.'));
    expect(await service.logo()).toEqual(saved);
  });

  it('refuses an image over the size limit', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)]);

    await expect(new BrandingService(database().prisma).setLogo(big)).rejects.toThrow('El logo no puede pesar más de 512 KB. Usa una imagen más pequeña.');
  });

  it('removes the logo', async () => {
    const { prisma, rows } = database();
    const service = new BrandingService(prisma);
    await service.setLogo(PNG);

    await service.removeLogo();

    expect(await service.logo()).toBeNull();
    expect(rows.has('logo')).toBe(false);
  });

  it('takes a stored value it cannot read as no logo', async () => {
    const { prisma, rows } = database();
    rows.set('logo', 'esto no es JSON');
    expect(await new BrandingService(prisma).logo()).toBeNull();

    rows.set('logo', JSON.stringify({ mime: 'image/png' }));
    expect(await new BrandingService(prisma).logo()).toBeNull();
  });
});

describe('BrandingController', () => {
  const setup = (): { controller: BrandingController; service: BrandingService; res: { set: jest.Mock } } => {
    const service = new BrandingService(database().prisma);
    return { controller: new BrandingController(service), service, res: { set: jest.fn() } };
  };

  it('says there is no logo, and answers 404 for the image', async () => {
    const { controller, res } = setup();

    expect(await controller.info()).toEqual({ logoVersion: null });
    await expect(controller.logo(res as unknown as Response)).rejects.toBeInstanceOf(NotFoundException);
    expect(res.set).not.toHaveBeenCalled();
  });

  it('serves the logo as the image it was checked to be, for browsers to keep', async () => {
    const { controller, res } = setup();
    const { logoVersion } = await controller.setLogo({ buffer: PNG } as Express.Multer.File);

    expect(await controller.info()).toEqual({ logoVersion });
    expect(await controller.logo(res as unknown as Response)).toBeInstanceOf(StreamableFile);
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Content-Length': String(PNG.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
  });

  it('refuses a request without a file', async () => {
    await expect(setup().controller.setLogo(undefined)).rejects.toThrow('No se recibió ninguna imagen');
  });

  it('removes the logo', async () => {
    const { controller } = setup();
    await controller.setLogo({ buffer: PNG } as Express.Multer.File);

    await controller.removeLogo();

    expect(await controller.info()).toEqual({ logoVersion: null });
  });

  // The login page and the browser tab icon ask before there is a session; changing the logo needs one.
  it('lets anyone read the logo, and only a logged-in person change it', () => {
    const isPublic = (method: keyof BrandingController): boolean =>
      Reflect.getMetadata('isPublic', (BrandingController.prototype as Record<keyof BrandingController, object>)[method]) === true;

    expect(isPublic('info')).toBe(true);
    expect(isPublic('logo')).toBe(true);
    expect(isPublic('setLogo')).toBe(false);
    expect(isPublic('removeLogo')).toBe(false);
  });
});
