import { moduleFullName, searchKey } from '../common/labels';

// The catalogs as an import finds in them what a sheet names: by the key of a name, however the
// sheet spells it. They also keep what the sheet names and the catalogs lack.

/** An entry of a catalog of names, as the import needs it. */
export interface CatalogEntry {
  id: number;
  name: string;
}

/**
 * One catalog of names as the import uses it: the companies, the responsibles or the support
 * types. It finds an entry by the `searchKey` of its name, so the sheet may write it with other
 * capitals, accents or spaces. It also keeps the names of the sheet that it lacks: one per name,
 * however the sheet spells it from row to row, under its first spelling.
 */
export class NameCatalog {
  private readonly entries = new Map<string, CatalogEntry>();
  /** Names of the sheet that the catalog lacks, by key, as first written. */
  private readonly missing = new Map<string, string>();
  /** Keys of the missing names that a row to import carries. */
  private readonly wanted = new Set<string>();

  /** `entries` is the whole catalog, active or not: a sheet that names a deactivated entry means that one, not a new one. */
  constructor(entries: CatalogEntry[]) {
    for (const entry of entries) this.entries.set(searchKey(entry.name), entry);
  }

  has(written: string): boolean {
    return this.entries.has(searchKey(written));
  }

  /** The name a case gets for what the sheet wrote: the one of the catalog, or the first spelling of a name it lacks. */
  read(written: string): { name: string; known: boolean } {
    const key = searchKey(written);
    const entry = this.entries.get(key);
    if (entry) return { name: entry.name, known: true };
    if (!this.missing.has(key)) this.missing.set(key, written);
    return { name: this.missing.get(key) ?? written, known: false };
  }

  /** A row to import carries this name, which the catalog lacks: it is one to add. */
  want(name: string): void {
    this.wanted.add(searchKey(name));
  }

  /** Every name of the sheet that the catalog lacks. */
  get unknown(): string[] {
    return [...this.missing.values()];
  }

  /** Of those, the ones to add: no entry is created for a row that is not imported. */
  get toCreate(): string[] {
    return [...this.missing].filter(([key]) => this.wanted.has(key)).map(([, name]) => name);
  }

  /** An entry just created. */
  add(name: string, id: number): void {
    this.entries.set(searchKey(name), { id, name });
  }

  id(name: string): number {
    const entry = this.entries.get(searchKey(name));
    // Every name of a row to import is here: the catalog had it, or it has just been added.
    if (!entry) throw new Error(`The import has no catalog entry for "${name}"`);
    return entry.id;
  }
}

/** `searchKey` of the name of a module, with its ">" spaced the same however the sheet writes it: "Ventas>Facturas". */
export function moduleKey(name: string): string {
  return searchKey(name.replace(/\s*>\s*/g, ' > '));
}

/**
 * The modules as the import finds them: by their full name ("Ventas > Facturas"), or by their own
 * name ("Facturas") while only one module is called so.
 */
export class ModuleCatalog {
  private readonly byFullName = new Map<string, { id: number; fullName: string }>();
  /** By own name, the keys of the full names of the modules called so. */
  private readonly sharing = new Map<string, Set<string>>();

  constructor(modules: { id: number; name: string; parent: { name: string } | null }[]) {
    for (const module of modules) {
      const fullName = moduleFullName(module);
      const key = moduleKey(fullName);
      // Two modules in one place cannot have one name (the unique index of the table), but a name
      // with a ">" in it can still give two modules the same full name. The first one is taken:
      // see the order of the query.
      if (!this.byFullName.has(key)) this.byFullName.set(key, { id: module.id, fullName });
      const own = searchKey(module.name);
      this.sharing.set(own, (this.sharing.get(own) ?? new Set<string>()).add(key));
    }
  }

  /**
   * The module a cell names. A list when the cell gives an own name that several modules have:
   * their full names, for the person to write one of them. Null when no module is called so.
   */
  find(written: string): { id: number; fullName: string } | string[] | null {
    const key = moduleKey(written);
    const exact = this.byFullName.get(key);
    if (exact) return exact;
    const called = [...(this.sharing.get(key) ?? [])].flatMap((fullKey) => this.byFullName.get(fullKey) ?? []);
    if (called.length === 1) return called[0];
    return called.length ? called.map((module) => module.fullName) : null;
  }

  /** Id of the module with this full name. */
  id(fullName: string): number | null {
    return this.byFullName.get(moduleKey(fullName))?.id ?? null;
  }
}
