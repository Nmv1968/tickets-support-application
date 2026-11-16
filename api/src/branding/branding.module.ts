import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

/** The logo of the company. */
@Module({ controllers: [BrandingController], providers: [BrandingService] })
export class BrandingModule {}
