import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROLLER_WATERMARK, GLOBAL_MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppModule } from './app.module';
import { AssigneesService } from './assignees/assignees.service';
import { CatalogsModule } from './catalogs.module';
import { JwtGuard, RolesGuard } from './common/auth';
import { NamedCatalogService } from './common/named-catalog';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { EventsController } from './events/events.controller';
import { PreferencesController } from './preferences/preferences.controller';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';
import { SupportTypesController } from './support-types/support-types.controller';
import { SupportTypesService } from './support-types/support-types.service';
import { apiControllers, apiModules, declared } from './testing';

// @nestjs/config is published as ES modules only, which Jest does not load here (jest.esm-transform.cjs
// turns only @nestjs/jwt into CommonJS). Its stand-in is also the wanted thing: the real one reads
// the .env files of whoever runs the tests, and all this spec asks the module for is the list of
// what it registers.
jest.mock('@nestjs/config', () => ({ ConfigModule: { forRoot: () => ({ module: class ConfigModule {} }) } }));

describe('AppModule', () => {
  const registered: unknown[] = apiControllers();

  /** Every controller class that a `*.controller.ts` file of the API exports, with where it is written. */
  const written = (): { file: string; name: string; controller: unknown }[] =>
    readdirSync(__dirname, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.controller.ts'))
      .flatMap((file) =>
        Object.entries(jest.requireActual<Record<string, unknown>>(join(__dirname, file)))
          .filter(([, exported]) => typeof exported === 'function' && Reflect.getMetadata(CONTROLLER_WATERMARK, exported) === true)
          .map(([name, controller]) => ({ file, name, controller })),
      );

  // Each controller is tested alone, over a fake database. None of those tests notices a controller
  // the application never mounts: every one of its routes answers 404, with all the suites green.
  it('registers every controller the API has', () => {
    const forgotten = written()
      .filter((entry) => !registered.includes(entry.controller))
      .map((entry) => `${entry.name} (${entry.file})`);

    expect(forgotten).toEqual([]);
  });

  it('has the companies, the support types and the preferences of each user among them', () => {
    expect(registered).toEqual(expect.arrayContaining([CompaniesController, SupportTypesController, PreferencesController]));
  });

  // The limits per address are guards of their own (see common/throttle.ts): without them in the
  // module, every test of the limits would pass and no request of the API would be limited. The
  // same goes for the routes only an administrator may use: without RolesGuard they answer anyone.
  it('limits the requests of each address before it looks at the login token, and the role after it', () => {
    const guards = (Reflect.getMetadata('providers', AppModule) as { provide?: unknown; useClass?: unknown }[])
      .filter((provider) => provider.provide === APP_GUARD)
      .map((provider) => provider.useClass);
    const imports = Reflect.getMetadata('imports', AppModule) as { module?: unknown }[];

    // First: a flood of requests without a valid token is cut before each one reaches the database.
    // Last: the role check reads the user the login check loaded.
    expect(guards).toEqual([ThrottlerGuard, JwtGuard, RolesGuard]);
    expect(imports.map((imported) => imported.module)).toContain(ThrottlerModule);
  });

  // The check above is only as good as the search it rests on.
  it('is checked against a search that finds a controller in every folder that has one', () => {
    const found = written();
    const folders = new Set(found.map((entry) => entry.file.split(/[\\/]/)[0]));

    expect([...folders].sort()).toEqual(
      [
        'ai',
        'assignees',
        'auth',
        'branding',
        'catalog',
        'companies',
        'dashboard',
        'events',
        'health',
        'preferences',
        'settings',
        'support-types',
        'tickets',
        'transfer',
        'users',
      ].sort(),
    );
    // Each one once, and none registered that the search did not see.
    expect(new Set(registered).size).toBe(registered.length);
    expect(found).toHaveLength(registered.length);
  });

  // A module that listed PrismaService among its own providers would give its controllers a client
  // of their own, with a pool of connections of its own, and the tests over a fake database would
  // still pass.
  it('provides the client of the database once, in a global module that every other one sees', () => {
    const providing = apiModules().filter((module) => declared(module, 'providers').includes(PrismaService));

    expect(providing).toEqual([PrismaModule]);
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, PrismaModule)).toBe(true);
  });

  // The rules of each part of the API live in its services, which the tests reach without HTTP. A
  // controller given the client of the database is where they start to spread again. The one of
  // the live events only checks, at each heartbeat, that the session of its stream still stands.
  it('leaves the database to the services: no controller is given PrismaService, but the one of the live events', () => {
    const given = registered.filter((controller) => ((Reflect.getMetadata('design:paramtypes', controller as object) as unknown[] | undefined) ?? []).includes(PrismaService));

    expect(given).toEqual([EventsController]);
  });

  // One implementation of a catalog of names, set up for each one: a change of its rules reaches the three.
  it('serves the companies, the responsibles and the support types with the one catalog of names', () => {
    const services = [CompaniesService, AssigneesService, SupportTypesService];

    expect(declared(CatalogsModule, 'providers')).toEqual(expect.arrayContaining(services));
    for (const service of services) expect(service.prototype).toBeInstanceOf(NamedCatalogService);
  });
});
