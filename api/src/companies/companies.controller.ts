import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { withCatalogLock } from '../common/catalog-lock';
import { IdPipe } from '../common/id.pipe';
import { searchKey, ticketSearchKey } from '../common/labels';
import { PrismaService } from '../prisma.service';

export const COMPANY_NAME_MAX = 200;

/** Used for both create and update. Create additionally requires the name. */
export class CompanyInput {
  @IsOptional()
  @IsString()
  @MaxLength(COMPANY_NAME_MAX, { message: `El nombre no puede tener más de ${COMPANY_NAME_MAX} caracteres` })
  name?: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

export interface CompanyDto {
  id: number;
  name: string;
  /** False keeps the cases it has and takes it out of the lists for new ones. */
  active: boolean;
  /** Cases of the company, open or closed. With any, the company cannot be deleted. */
  tickets: number;
}

const withCount = { _count: { select: { tickets: true } } } as const;

function toDto(row: { id: number; name: string; active: boolean; _count: { tickets: number } }): CompanyDto {
  return { id: row.id, name: row.name, active: row.active, tickets: row._count.tickets };
}

/** The client companies that report cases. A catalog of names: every case points at one of them. */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Every company, active first. The screens that register a case offer the active ones. */
  @Get()
  async list(): Promise<CompanyDto[]> {
    const rows = await this.prisma.company.findMany({ include: withCount });
    return rows.map(toDto).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'));
  }

  @Post()
  async create(@Body() dto: CompanyInput): Promise<CompanyDto> {
    const name = tidyName(dto.name);
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    // "Crear empresa «X»" is one click on three screens, so two people registering a case of the
    // same new client send the same name at once. Asking whether the name is free and adding it
    // is done by one request at a time.
    return withCatalogLock(this.prisma, 'companies', async (tx) => {
      await assertNameFree(tx, name, null);
      return toDto(await tx.company.create({ data: { name }, include: withCount }));
    });
  }

  @Patch(':id')
  async update(@Param('id', IdPipe) id: number, @Body() dto: CompanyInput): Promise<CompanyDto> {
    const name = tidyName(dto.name);
    if (name !== null) await assertNameFree(this.prisma, name, id);
    const caseWrites = name === null ? [] : await this.searchTextWrites(id, name);
    // One transaction: the company never has its new name while its cases still carry the old one.
    const [row] = await this.prisma.$transaction([
      this.prisma.company.update({
        where: { id },
        // `@IsOptional()` lets a null through, and neither column can be empty: null means "not sent".
        data: { name: name ?? undefined, active: dto.active ?? undefined },
        include: withCount,
      }),
      ...caseWrites,
    ]);
    return toDto(row);
  }

  /** Only a company without cases: a case cannot be left without its company. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', IdPipe) id: number): Promise<void> {
    const row = await this.prisma.company.findUnique({ where: { id }, include: withCount });
    if (!row) throw new NotFoundException('La empresa no existe');
    const cases = row._count.tickets;
    if (cases > 0) {
      throw new ConflictException(
        `${row.name} tiene ${cases} ${cases === 1 ? 'caso' : 'casos'}. ` +
          'Desactívala para que no aparezca en los casos nuevos, o cambia la empresa de sus casos antes de eliminarla.',
      );
    }
    await this.prisma.company.delete({ where: { id } });
  }

  /**
   * The writes a rename owes to the cases of the company. The search box matches
   * `Ticket.searchText`, which holds the name of the company: left as it was, those cases would
   * only be found by the old name.
   */
  private async searchTextWrites(id: number, name: string): Promise<Prisma.PrismaPromise<unknown>[]> {
    const cases = await this.prisma.ticket.findMany({ where: { companyId: id }, select: { id: true, description: true } });
    return cases.map((ticket) =>
      this.prisma.ticket.update({ where: { id: ticket.id }, data: { searchText: ticketSearchKey(name, ticket.description) }, select: { id: true } }),
    );
  }
}

/** The name as it will be stored: without spaces around it or repeated inside. Null when none was sent. */
function tidyName(sent: string | null | undefined): string | null {
  return sent?.replace(/\s+/g, ' ').trim() || null;
}

/**
 * Refuses a name that another company has. Two companies cannot differ only in case or accents:
 * the import and the assistants find them by name. `db` is where the others are read: for a new
 * company, the transaction that holds the lock of the catalog.
 */
async function assertNameFree(db: Prisma.TransactionClient, name: string, selfId: number | null): Promise<void> {
  const key = searchKey(name);
  const others = await db.company.findMany({ where: selfId === null ? undefined : { id: { not: selfId } }, select: { name: true, active: true } });
  const taken = others.find((other) => searchKey(other.name) === key);
  if (!taken) return;
  // A deactivated company is in none of the lists that offer one: whoever types its name finds
  // nothing, tries to add it and has to be told where it is.
  throw new ConflictException(`Ya existe una empresa con ese nombre${taken.active ? '' : ', pero está inactiva. Actívala en Configuración > Empresas.'}`);
}
