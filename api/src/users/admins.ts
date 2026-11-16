import { Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/**
 * An administrator who can log in: someone who can still manage the users and the settings. The
 * API never leaves the users without one (`UsersController.update`), and the start-up makes the
 * first user one again when there is none (`SeedService`).
 */
export const WORKING_ADMIN = { role: Role.ADMIN, active: true, passwordHash: { not: null } } satisfies Prisma.UserWhereInput;
