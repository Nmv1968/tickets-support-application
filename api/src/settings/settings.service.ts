import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const STALE_HOURS_KEY = 'reminders.staleHours';
const PROMISE_SOON_DAYS_KEY = 'reminders.promiseSoonDays';

const DEFAULTS: Record<string, number> = {
  [STALE_HOURS_KEY]: 48,
  // Off until the team turns it on: the day-of and overdue promise reminders always apply.
  [PROMISE_SOON_DAYS_KEY]: 0,
};

/** What the ticket queries need to know about reminders. Read once per request. */
export interface ReminderRules {
  /** Open cases whose last activity is before this moment are forgotten. Null when that reminder is off. */
  staleBefore: Date | null;
  /** Days before the promised delivery date at which a case counts as "promise due soon". 0 = off. */
  promiseSoonDays: number;
}

/** App-wide settings stored in the database and edited from Configuración. */
@Injectable()
export class SettingsService {
  /** Read on almost every ticket request, so values are kept in memory after the first read. */
  private readonly cache = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /** Hours an open case can go without any activity before it counts as forgotten. 0 turns it off. */
  staleHours(): Promise<number> {
    return this.read(STALE_HOURS_KEY);
  }

  setStaleHours(hours: number): Promise<void> {
    return this.write(STALE_HOURS_KEY, hours);
  }

  /** Days of advance notice before a promised delivery date. 0 = no advance notice. */
  promiseSoonDays(): Promise<number> {
    return this.read(PROMISE_SOON_DAYS_KEY);
  }

  setPromiseSoonDays(days: number): Promise<void> {
    return this.write(PROMISE_SOON_DAYS_KEY, days);
  }

  async reminderRules(): Promise<ReminderRules> {
    const [hours, promiseSoonDays] = await Promise.all([this.staleHours(), this.promiseSoonDays()]);
    return { staleBefore: hours > 0 ? new Date(Date.now() - hours * 3_600_000) : null, promiseSoonDays };
  }

  private async read(key: string): Promise<number> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const stored = Number(row?.value);
    const value = row && Number.isFinite(stored) && stored >= 0 ? stored : DEFAULTS[key];
    this.cache.set(key, value);
    return value;
  }

  private async write(key: string, value: number): Promise<void> {
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
    this.cache.set(key, value);
  }
}
