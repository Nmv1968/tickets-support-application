import type { PrismaService } from '../prisma.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

describe('reminder settings', () => {
  type Reminders = Parameters<SettingsController['saveReminders']>[0];

  /** The controller and the real service over a fake database without stored settings. */
  const setup = () => {
    const db = { setting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) } };
    return { db, controller: new SettingsController(new SettingsService(db as unknown as PrismaService)) };
  };

  // The checks of the request body let a null through. Stored, it turned the reminder off until the API restarted.
  it('reads a null as "not sent": nothing is stored and the reminders stay as they were', async () => {
    const { db, controller } = setup();

    await controller.saveReminders({ staleHours: null, promiseSoonDays: null } as unknown as Reminders);

    expect(db.setting.upsert).not.toHaveBeenCalled();
    expect(await controller.reminders()).toEqual({ staleHours: 48, promiseSoonDays: 0 });
  });

  it('stores only the reminder that is sent', async () => {
    const { db, controller } = setup();

    await controller.saveReminders({ promiseSoonDays: 3 });

    expect(db.setting.upsert).toHaveBeenCalledTimes(1);
    expect(db.setting.upsert).toHaveBeenCalledWith({
      where: { key: 'reminders.promiseSoonDays' },
      create: { key: 'reminders.promiseSoonDays', value: '3' },
      update: { value: '3' },
    });
    expect(await controller.reminders()).toEqual({ staleHours: 48, promiseSoonDays: 3 });
  });

  it('stores 0, which turns a reminder off', async () => {
    const { db, controller } = setup();

    await controller.saveReminders({ staleHours: 0, promiseSoonDays: 0 });

    expect(db.setting.upsert).toHaveBeenCalledTimes(2);
    expect(await controller.reminders()).toEqual({ staleHours: 0, promiseSoonDays: 0 });
  });
});
