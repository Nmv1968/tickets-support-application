import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Priority } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from './prisma.service';

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

/** Fills empty tables on first start. Never touches existing data. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedAdmin();
    await this.seedAssistantUser();

    if ((await this.prisma.slaPolicy.count()) === 0) {
      await this.prisma.slaPolicy.createMany({
        data: Object.entries(INITIAL_SLA).map(([priority, hours]) => ({ priority: priority as Priority, hours })),
      });
    }

    if ((await this.prisma.systemModule.count()) === 0) {
      await this.prisma.systemModule.createMany({ data: INITIAL_MODULES.map((name) => ({ name })) });
    }
  }

  /**
   * User the MCP server logs in with, so cases an AI assistant registers or closes show
   * its name in the history. Exists only when MCP_PASSWORD is set. The password follows
   * the environment on every start; name and active state stay as edited in the app.
   */
  private async seedAssistantUser(): Promise<void> {
    const password = process.env.MCP_PASSWORD;
    if (!password) return;
    const username = (process.env.MCP_USERNAME ?? 'claude').trim().toLowerCase();
    const passwordHash = await hash(password, 10);
    await this.prisma.user.upsert({
      where: { username },
      create: { username, name: process.env.MCP_NAME ?? 'Claude', passwordHash },
      update: { passwordHash },
    });
  }

  private async seedAdmin(): Promise<void> {
    if ((await this.prisma.user.count({ where: { passwordHash: { not: null } } })) > 0) return;

    const username = (process.env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      this.logger.warn('No hay usuarios y ADMIN_PASSWORD no está definido: nadie puede iniciar sesión.');
      return;
    }

    const data = { name: process.env.ADMIN_NAME ?? 'Administrador', passwordHash: await hash(password, 10), active: true };
    await this.prisma.user.upsert({ where: { username }, create: { username, ...data }, update: data });
    this.logger.log(`Usuario inicial "${username}" creado con la contraseña de ADMIN_PASSWORD.`);
  }
}
