import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Priority, Role } from '@prisma/client';
import { compare } from 'bcryptjs';
import { searchKey } from './common/labels';
import { END_SESSIONS } from './common/session-token';
import { EventsService } from './events/events.service';
import { PrismaService } from './prisma.service';
import { WORKING_ADMIN } from './users/admins';
import { hashPassword, seededUsernames } from './users/credentials';

/** Starting point only. The team edits the catalog from Configuración > Módulos. */
const INITIAL_MODULES = [
  'Ventas',
  'Compras',
  'Inventario',
  'Órdenes de trabajo',
  'Servicios',
  'Clientes y proveedores',
  'Contabilidad y finanzas',
  'Caja y bancos',
  'Impuestos',
  'Facturación electrónica',
  'Recursos humanos / Nómina',
  'Manufactura',
  'Proyectos',
  'Reportes',
  'Cargas masivas (Excel)',
  'Impresión de documentos',
  'Configuración y permisos',
  'Acceso y sesión',
  'Otros',
];

const INITIAL_SLA: Record<Priority, number> = { CRITICAL: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

/**
 * Fills empty tables on first start. Of the data that exists it only touches the assistant user
 * (see `seedAssistantUser`), and the first user when nobody is left who can administer.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  /**
   * `events` hears of each write here that ends the sessions of a user, as it hears of every one
   * (`EventsService.sessionsEnded`). On a start no stream is open yet: the API listens after it.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // The assistant first: making it an agent may leave nobody who administers, and the next step
    // is the one that sees to that.
    await this.seedAssistantUser();
    await this.seedAdmin();

    if ((await this.prisma.slaPolicy.count()) === 0) {
      await this.prisma.slaPolicy.createMany({
        data: Object.entries(INITIAL_SLA).map(([priority, hours]) => ({ priority: priority as Priority, hours })),
      });
    }

    if ((await this.prisma.systemModule.count()) === 0) {
      await this.prisma.systemModule.createMany({ data: INITIAL_MODULES.map((name) => ({ name, nameKey: searchKey(name) })) });
    }
  }

  /**
   * User the MCP server logs in with, so cases an AI assistant registers or closes show
   * its name in the history. Exists only when MCP_PASSWORD is set. The password follows
   * the environment on every start, and so does its role: an agent, whatever someone made
   * it in the app. Name and active state stay as edited in the app. When either one had to
   * be put back, the sessions open with the user end, as with any change of password or role.
   */
  private async seedAssistantUser(): Promise<void> {
    const password = process.env.MCP_PASSWORD;
    if (!password) return;
    const username = seededUsernames(process.env).assistant;
    const existing = await this.prisma.user.findUnique({ where: { username }, select: { passwordHash: true, role: true } });
    const samePassword = !!existing?.passwordHash && (await compare(password, existing.passwordHash));
    if (samePassword && existing?.role === Role.AGENT) return;

    const passwordHash = samePassword && existing?.passwordHash ? existing.passwordHash : await hashPassword(password);
    const { id } = await this.prisma.user.upsert({
      where: { username },
      create: { username, name: process.env.MCP_NAME ?? 'Claude', passwordHash, role: Role.AGENT },
      update: { passwordHash, role: Role.AGENT, ...END_SESSIONS },
    });
    // A user made now has no session yet.
    if (existing) this.events.sessionsEnded(id);
  }

  /**
   * The first user, an administrator. Made when no administrator can log in: on the first start,
   * and also if the assistant user was the only one (it has just become an agent). A user with
   * that username who already has a password keeps it, and becomes an administrator again.
   */
  private async seedAdmin(): Promise<void> {
    if ((await this.prisma.user.count({ where: WORKING_ADMIN })) > 0) return;

    const username = seededUsernames(process.env).admin;
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      this.logger.warn('No hay ningún administrador que pueda iniciar sesión y ADMIN_PASSWORD no está definido: nadie puede administrar el sistema.');
      return;
    }

    // Either way the user changes role, password or state: a session they had open does not go on.
    const existing = await this.prisma.user.findUnique({ where: { username }, select: { passwordHash: true } });
    if (existing?.passwordHash) {
      const { id } = await this.prisma.user.update({ where: { username }, data: { role: Role.ADMIN, active: true, ...END_SESSIONS } });
      this.events.sessionsEnded(id);
      this.logger.log(`No quedaba ningún administrador: el usuario "${username}" vuelve a serlo, con su contraseña de siempre.`);
      return;
    }

    const data = { name: process.env.ADMIN_NAME ?? 'Administrador', passwordHash: await hashPassword(password), active: true, role: Role.ADMIN };
    const { id } = await this.prisma.user.upsert({ where: { username }, create: { username, ...data }, update: { ...data, ...END_SESSIONS } });
    if (existing) this.events.sessionsEnded(id);
    this.logger.log(`Usuario inicial "${username}" creado como administrador, con la contraseña de ADMIN_PASSWORD.`);
  }
}
