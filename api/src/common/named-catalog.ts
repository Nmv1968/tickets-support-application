import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service';
import { searchKey } from './labels';
import { violatesUnique } from './prisma-exception.filter';

// The catalogs of names: the companies, the responsibles and the support types. A case points at
// their entries, which cannot repeat a name, are deactivated instead of deleted while a case has
// them, and are answered with the number of cases that do. `NamedCatalogService` is all of that,
// once; each catalog sets it up with its `NamedCatalogRules`: its table, its texts, and what it
// stores besides the name.

/** A name as the catalogs keep it: without spaces around it, and with single spaces inside. */
export function tidyName(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A name that the cases or the reports already use for something else: no entry can be called so. */
export interface ReservedName {
  /** True for that name, however it is written. */
  means: (name: string) => boolean;
  /** Why the name is refused, in the 400. */
  refusal: (name: string) => string;
}

/**
 * The label the reports give the cases without an entry of the catalog ("Sin tipo", "Sin módulo"),
 * as a reserved name: an entry called so would give them two rows with the same label and
 * different counts. `one` is how the refusal names an entry: "un tipo de soporte".
 */
export function labelOfNone(label: string, one: string): ReservedName {
  return {
    means: (name) => searchKey(name) === searchKey(label),
    refusal: (name) => `"${name}" no puede ser el nombre de ${one}: en los reportes ya significa que el caso no tiene ninguno`,
  };
}

/**
 * The name a request sent, as the catalog will store it: `tidy` applied, `tidyName` unless the
 * catalog says otherwise. Null when none was sent: `@IsOptional()` lets a null through, and no
 * name can be empty. A reserved name is refused with a 400.
 */
export function usableName(sent: string | null | undefined, reserved?: ReservedName, tidy: (text: string) => string = tidyName): string | null {
  const name = sent ? tidy(sent) : '';
  if (!name) return null;
  if (reserved?.means(name)) throw new BadRequestException(reserved.refusal(name));
  return name;
}

/** The name of a new entry, which it cannot go without: as `usableName`, and a 400 when none was sent. */
export function requiredName(sent: string | null | undefined, reserved?: ReservedName, tidy?: (text: string) => string): string {
  const name = usableName(sent, reserved, tidy);
  if (!name) throw new BadRequestException('El nombre es obligatorio');
  return name;
}

/** The cases of an entry, which every answer counts and a delete looks at. */
export const WITH_CASES = { _count: { select: { tickets: true } } } as const;

/** An entry as the catalogs read it, with the number of its cases. */
export interface CountedEntry {
  id: number;
  name: string;
  active: boolean;
  _count: { tickets: number };
}

/** An entry as the API answers it. A catalog with fields of its own adds them, as the colour of a type. */
export interface NamedEntryDto {
  id: number;
  name: string;
  /** False keeps it on the cases that have it and takes it out of the lists for new ones. */
  active: boolean;
  /** Cases that have it, open or closed. With any, it cannot be deleted. */
  tickets: number;
}

/** The answer for `row`. The fields of its own of a catalog (`extra`) go after the name, where the API has always had them. */
export function entryDto(row: CountedEntry): NamedEntryDto;
export function entryDto<Extra extends object>(row: CountedEntry, extra: Extra): NamedEntryDto & Extra;
export function entryDto(row: CountedEntry, extra: object = {}): NamedEntryDto {
  return { id: row.id, name: row.name, ...extra, active: row.active, tickets: row._count.tickets };
}

/** What a request can send for any entry. A new one needs the name. */
export interface NamedInput {
  name?: string | null;
  active?: boolean | null;
}

/**
 * The column of a catalog that holds the key of each name, `searchKey(name)`: `sortKey` for the
 * companies, `nameKey` for the others. Its unique index is what keeps a name from repeating.
 */
export type NameKeyColumn = 'sortKey' | 'nameKey';

/** The calls the catalogs make on their tables. */
export interface NamedTable<Row extends CountedEntry> {
  findMany(args: { include: typeof WITH_CASES }): Promise<Row[]>;
  findUnique(args: { where: { id: number }; include: typeof WITH_CASES }): Promise<Row | null>;
  findUnique(args: { where: Partial<Record<NameKeyColumn, string>>; select: { active: true } }): Promise<{ active: boolean } | null>;
  create(args: { data: { name: string }; include: typeof WITH_CASES }): Promise<Row>;
  update(args: { where: { id: number }; data: { name?: string; active?: boolean }; include: typeof WITH_CASES }): Prisma.PrismaPromise<Row>;
  delete(args: { where: { id: number } }): Promise<unknown>;
}

/**
 * A table of the Prisma client as `NamedCatalogService` calls it: `company`, `assignee` or
 * `supportType`. Prisma's methods are generic over their arguments, and TypeScript does not
 * compare them with plain signatures, so this is the one place where the two meet unchecked. What
 * a catalog writes is checked where it is built, against the input types of its table: see
 * `newEntry` and `edit` of each catalog.
 */
export function namedTable<Row extends CountedEntry>(table: Prisma.TransactionClient['company' | 'assignee' | 'supportType']): NamedTable<Row> {
  return table as unknown as NamedTable<Row>;
}

/** What makes each catalog of names what it is. */
export interface NamedCatalogRules<Row extends CountedEntry, Dto, Input extends NamedInput> {
  /** Its table, in the client or in a transaction. */
  table: (db: Prisma.TransactionClient) => NamedTable<Row>;
  /** Its column with the key of the name. `newEntry` and `edit` write it next to every name. */
  key: NameKeyColumn;
  /**
   * The columns a new entry is stored with: the name, its key, and what goes with them. Refuses
   * with a 400 what a new entry needs and `input` lacks. The import stores what a sheet adds with
   * it too.
   */
  newEntry: (name: string, input: Input) => { name: string };
  /**
   * What an edit writes besides the name and the state: the columns that go with a new name, its
   * key among them (null: not renamed), and the fields of its own sent.
   */
  edit: (name: string | null, input: Input) => object;
  toDto: (row: Row) => Dto;
  /** A name that no entry can have, new or renamed. */
  reserved?: ReservedName;
  /** Writes that a rename owes to the cases of the entry, run in one transaction with it. */
  renameWrites?: (db: PrismaService, id: number, name: string) => Promise<Prisma.PrismaPromise<unknown>[]>;
  messages: {
    /** The 404 of a delete of an entry that is not there. */
    missing: string;
    /** The 409 of a name that another entry has, for a new entry or a rename. */
    taken: string;
    /**
     * The same, when the other entry is deactivated: it is in none of the lists that offer one, so
     * whoever looks for the name finds nothing, tries to add it and has to be told where it is.
     */
    takenInactive: string;
    /** The 409 of a delete of an entry that `cases` cases have, with what to do instead. */
    inUse: (name: string, cases: number) => string;
  };
}

/**
 * A catalog of names: what its routes do, for any of them. Two entries cannot differ only in case,
 * accents or spaces (`searchKey`): the import and the assistants find them by name. The database
 * keeps them apart, with a unique index on the key of the name, and this turns its refusal into
 * the 409 of the catalog. A catalog's service is this one, given its rules.
 */
export class NamedCatalogService<Row extends CountedEntry, Dto, Input extends NamedInput> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: NamedCatalogRules<Row, Dto, Input>,
  ) {}

  /** Every entry, active first, then by name. The screens that register or edit a case offer the active ones. */
  async list(): Promise<Dto[]> {
    const rows = await this.rules.table(this.prisma).findMany({ include: WITH_CASES });
    return rows.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es')).map(this.rules.toDto);
  }

  async create(input: Input): Promise<Dto> {
    const name = requiredName(input.name, this.rules.reserved);
    const data = this.rules.newEntry(name, input);
    // "Crear empresa «X»" and the like are one click on the screens that register a case, so two
    // people with a case of the same new client send the same name at once. The index lets the
    // first one in, and the other is told the name is taken.
    return this.rules.toDto(await this.unlessTaken(name, () => this.rules.table(this.prisma).create({ data, include: WITH_CASES })));
  }

  async update(id: number, input: Input): Promise<Dto> {
    const name = usableName(input.name, this.rules.reserved);
    // `@IsOptional()` lets a null through, and none of these columns can be empty: null means "not sent".
    const data = { name: name ?? undefined, ...this.rules.edit(name, input), active: input.active ?? undefined };
    const { renameWrites } = this.rules;
    const table = this.rules.table(this.prisma);
    const row = await this.unlessTaken(name, async () => {
      if (!renameWrites) return table.update({ where: { id }, data, include: WITH_CASES });
      const caseWrites = name === null ? [] : await renameWrites(this.prisma, id, name);
      // One transaction: the entry never has its new name while its cases still carry the old one.
      const [updated] = await this.prisma.$transaction([table.update({ where: { id }, data, include: WITH_CASES }), ...caseWrites]);
      return updated;
    });
    return this.rules.toDto(row);
  }

  /** Only an entry no case has: deleting it would leave those cases without it, and the history without the name. */
  async remove(id: number): Promise<void> {
    const table = this.rules.table(this.prisma);
    const row = await table.findUnique({ where: { id }, include: WITH_CASES });
    if (!row) throw new NotFoundException(this.rules.messages.missing);
    const cases = row._count.tickets;
    if (cases > 0) throw new ConflictException(this.rules.messages.inUse(row.name, cases));
    await table.delete({ where: { id } });
  }

  /**
   * Does `write`, which stores `name` (null: the name is not changed). When another entry has a
   * name with the same key, however it is written, the unique index refuses the write, and the
   * answer is the 409 of the catalog: the one that says where the other entry is, if it is
   * deactivated. A rename to its own name written another way keeps the key of the entry itself,
   * which the index lets through.
   */
  private async unlessTaken<T>(name: string | null, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (name === null || !violatesUnique(error, this.rules.key)) throw error;
      const taken = await this.rules.table(this.prisma).findUnique({ where: { [this.rules.key]: searchKey(name) }, select: { active: true } });
      throw new ConflictException(taken?.active === false ? this.rules.messages.takenInactive : this.rules.messages.taken);
    }
  }
}
