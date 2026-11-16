import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** The numbers of the cases, and their report in Excel and PDF. */
@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
