import { day } from '../common/testing';
import type { PrismaService } from '../prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { TransferService } from './transfer.service';

// What the tests of the transfers share. Only tests load this file: the build leaves it out
// (tsconfig.build.json).

/** What every list and export asks for unless the filter says otherwise: the cases that are not archived. */
export const active = { archivedAt: null };

/**
 * A TransferService over a fake database: an object with only the Prisma calls the test expects.
 * The filters go through the real `buildWhere`, with both reminders off.
 */
export function serviceOn(db: object): TransferService {
  const settings: Pick<SettingsService, 'reminderRules'> = {
    reminderRules: () => Promise.resolve({ staleBefore: null, promiseSoonDays: 0 }),
  };
  return new TransferService(db as PrismaService, settings as SettingsService);
}

/** A case as the export query returns it. */
export const exportRow = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 7,
  date: day('2026-11-02'),
  company: { name: 'ACME' },
  description: 'No abre la factura',
  status: 'PENDING',
  assignees: [{ assignee: { name: 'Ana' } }],
  priority: 'HIGH',
  module: { name: 'Facturas' },
  supportTypes: [],
  estimatedMinutes: 30,
  spentMinutes: 0,
  promisedDate: null,
  dueAt: null,
  resolvedAt: null,
  archivedAt: null,
  createdAt: new Date(2026, 10, 2, 9, 0),
  notes: [],
  ...changes,
});
