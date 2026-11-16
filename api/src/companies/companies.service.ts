import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { searchKey, ticketSearchKey } from '../common/labels';
import { NamedCatalogService, entryDto, namedTable } from '../common/named-catalog';
import type { CountedEntry, NamedCatalogRules, NamedEntryDto } from '../common/named-catalog';
import { tooLong } from '../common/validation';
import { PrismaService } from '../prisma.service';

export const COMPANY_NAME_MAX = 200;

/** Used for both create and update. Create additionally requires the name. */
export class CompanyInput {
  @IsOptional()
  @IsString()
  @MaxLength(COMPANY_NAME_MAX, tooLong('El nombre', COMPANY_NAME_MAX))
  name?: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

/** A company, with the number of its cases. */
export type CompanyDto = NamedEntryDto;

/** The client companies that report cases. A catalog of names: every case points at one of them. */
export const COMPANIES = {
  table: (db) => namedTable(db.company),
  // The key the list of cases orders the companies by, and the one that keeps two of them from
  // having the same name. It goes with the name, or a renamed company would keep the place of its
  // old name.
  key: 'sortKey',
  newEntry: (name: string): Prisma.CompanyCreateManyInput => ({ name, sortKey: searchKey(name) }),
  edit: (name: string | null): Prisma.CompanyUpdateInput => ({ sortKey: name === null ? undefined : searchKey(name) }),
  toDto: (row: CountedEntry): CompanyDto => entryDto(row),
  /**
   * The search box matches `Ticket.searchText`, which holds the name of the company: left as it
   * was, the cases of a renamed company would only be found by the old name. One statement for all
   * of its cases, however many: the key of each one is worked out here, with the `ticketSearchKey`
   * of every other write of a case, and the database gets the list. A case moved to another company
   * meanwhile is left alone. `updatedAt` as Prisma writes it: the moment in UTC.
   */
  renameWrites: async (db, id, name) => {
    const cases = await db.ticket.findMany({ where: { companyId: id }, select: { id: true, description: true } });
    if (!cases.length) return [];
    const ids = cases.map((ticket) => ticket.id);
    const keys = cases.map((ticket) => ticketSearchKey(name, ticket.description));
    return [
      db.$executeRaw`
        UPDATE "Ticket" SET "searchText" = renamed."searchText", "updatedAt" = now() AT TIME ZONE 'UTC'
        FROM unnest(${ids}::integer[], ${keys}::text[]) AS renamed("id", "searchText")
        WHERE "Ticket"."id" = renamed."id" AND "Ticket"."companyId" = ${id}`,
    ];
  },
  messages: {
    missing: 'La empresa no existe',
    taken: 'Ya existe una empresa con ese nombre',
    takenInactive: 'Ya existe una empresa con ese nombre, pero está inactiva. Actívala en Configuración > Empresas.',
    // A case cannot be left without its company.
    inUse: (name: string, cases: number) =>
      `${name} tiene ${cases} ${cases === 1 ? 'caso' : 'casos'}. ` +
      'Desactívala para que no aparezca en los casos nuevos, o cambia la empresa de sus casos antes de eliminarla.',
  },
} satisfies NamedCatalogRules<CountedEntry, CompanyDto, CompanyInput>;

@Injectable()
export class CompaniesService extends NamedCatalogService<CountedEntry, CompanyDto, CompanyInput> {
  constructor(prisma: PrismaService) {
    super(prisma, COMPANIES);
  }
}
