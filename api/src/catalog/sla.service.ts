import { Injectable } from '@nestjs/common';
import { Priority } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { PRIORITIES } from '../common/labels';
import { PrismaService } from '../prisma.service';

export class SlaItem {
  @IsEnum(Priority) priority!: Priority;
  @IsInt() @Min(1) @Max(24 * 365) hours!: number;
}

export class SlaInput {
  @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => SlaItem) items!: SlaItem[];
}

/** The hours each priority gives a case to be resolved in: its deadline. */
@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every priority, with 0 hours for one the SLA gives none. */
  async hours(): Promise<{ priority: Priority; hours: number }[]> {
    const rows = await this.prisma.slaPolicy.findMany();
    return PRIORITIES.map((priority) => ({ priority, hours: rows.find((r) => r.priority === priority)?.hours ?? 0 }));
  }

  /** New hours apply to tickets created or re-prioritised from now on. */
  async save(items: SlaItem[]): Promise<void> {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.slaPolicy.upsert({
          where: { priority: item.priority },
          create: { priority: item.priority, hours: item.hours },
          update: { hours: item.hours },
        }),
      ),
    );
  }
}
