import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api';
import type { Assignee, Company, SupportType, SystemModule, User } from './api';
import { Toast } from './toast';
import { nameKey } from './ui';

/** The longest name the server stores in each catalog. */
export const NAME_MAX = { company: 200, assignee: 80, supportType: 60 } as const;

/** The option of a filter by responsible for the cases nobody has. */
export const NOBODY = { id: 'none', name: 'Sin asignar' } as const;

/** Users, responsibles, companies, support types, modules and AI availability, loaded once and shared by every screen. */
@Injectable({ providedIn: 'root' })
export class Catalogs {
  private readonly api = inject(Api);

  readonly users = signal<User[]>([]);
  /** Everyone a case can be assigned to, active or not. They are not the users of the app. */
  readonly assignees = signal<Assignee[]>([]);
  /** Every client company, active or not. */
  readonly companies = signal<Company[]>([]);
  /** Every support type, active or not. */
  readonly supportTypes = signal<SupportType[]>([]);
  /** Every module, active or not. */
  readonly modules = signal<SystemModule[]>([]);
  /** True when an AI provider is active with a model chosen. Screens use it to offer AI actions. */
  readonly aiReady = signal(false);

  // What is offered for a new case. The filters and the cases that already have one use the whole list.
  readonly activeAssignees = computed(() => this.assignees().filter((person) => person.active));
  readonly activeCompanies = computed(() => this.companies().filter((company) => company.active));
  readonly activeSupportTypes = computed(() => this.supportTypes().filter((type) => type.active));
  readonly activeModules = computed(() => this.modules().filter((module) => module.active));
  /** What a filter by responsible offers: everyone of the catalog, active or not (their cases are still theirs), and the cases nobody has. */
  readonly assigneeFilterOptions = computed<{ id: number | 'none'; name: string }[]>(() => [NOBODY, ...this.assignees()]);

  private loaded = false;

  async ensure(): Promise<void> {
    if (!this.loaded) await this.reload();
  }

  async reload(): Promise<void> {
    const [users, assignees, companies, supportTypes, modules, ai] = await Promise.all([
      this.api.users(),
      this.api.assignees(),
      this.api.companies(),
      this.api.supportTypes(),
      // Asked for whole: left alone, the server lists only the active ones.
      this.api.modules(true),
      this.api.aiConfig(),
    ]);
    this.users.set(users);
    this.assignees.set(assignees);
    this.companies.set(companies);
    this.supportTypes.set(supportTypes);
    this.modules.set(modules);
    this.aiReady.set(ai.some((provider) => provider.active && !!provider.model));
    this.loaded = true;
  }

  /**
   * Adds a company to the catalog, for a select that creates the one the person typed ("Crear
   * empresa «X»"). It joins the list here at once, without reading every catalog again: the
   * select that asked has to offer it right then. The other tabs hear of it through the live updates.
   */
  async createCompany(name: string): Promise<Company> {
    const company = await this.api.createCompany(name);
    // In its place, as the server lists them: the active ones first, then by name.
    this.companies.update((companies) =>
      [...companies.filter((other) => other.id !== company.id), company].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es')),
    );
    return company;
  }
}

/**
 * "Crear empresa «X»" for a select of companies: what it takes as its `addTag`. Adds the company
 * with the name typed to the catalog and gives it back, for the select to choose it. A refusal is
 * said here and nothing is chosen: the select says nothing when its promise fails.
 *
 * For a field of the component that has the select (`createCompany = companyCreator()`): it is
 * made while the component is, and the select calls it on its own.
 *
 * The select calls it again for a second press on the option before the server has answered (a
 * double click, Enter twice). That is the same creation, with the same outcome: sent again, the
 * server would refuse it for a name that already exists, the one just created.
 */
export function companyCreator(): (name: string) => Promise<Company> {
  const catalogs = inject(Catalogs);
  const toast = inject(Toast);
  /** The creations on their way, each under its name as the server compares names. */
  const pending = new Map<string, Promise<Company>>();

  const create = async (name: string): Promise<Company> => {
    try {
      const company = await catalogs.createCompany(name.trim());
      toast.ok(`Empresa «${company.name}» creada`);
      return company;
    } catch (error) {
      toast.error(error);
      throw error;
    }
  };

  return (name) => {
    const key = nameKey(name);
    let creation = pending.get(key);
    if (!creation) {
      creation = create(name).finally(() => pending.delete(key));
      pending.set(key, creation);
    }
    return creation;
  };
}

/**
 * The entry of a catalog a name refers to, however it was written: capitals, accents and extra
 * spaces do not count, as for the server when it tells whether a name already exists.
 */
export function findByName<T extends { name: string }>(entries: readonly T[], name: string): T | undefined {
  const key = nameKey(name);
  return key ? entries.find((entry) => nameKey(entry.name) === key) : undefined;
}

/**
 * What a select of a case offers out of a catalog: its active entries and the ones the case
 * has, whatever their state. An entry the catalog does not bring (it is still on its way) is
 * offered as the case itself names it.
 */
export function offered<T extends { id: number }>(catalog: readonly (T & { active: boolean })[], own: readonly T[]): T[] {
  const options: T[] = catalog.filter((entry) => entry.active || own.some((mine) => mine.id === entry.id));
  return [...options, ...own.filter((mine) => !options.some((entry) => entry.id === mine.id))];
}
