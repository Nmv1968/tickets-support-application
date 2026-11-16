import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROLLER_WATERMARK } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppModule } from './app.module';
import { JwtGuard, RolesGuard } from './common/auth';
import { CompaniesController } from './companies/companies.controller';
import { PreferencesController } from './preferences/preferences.controller';
import { SupportTypesController } from './support-types/support-types.controller';

// @nestjs/config is published as ES modules only, which Jest does not load here (jest.esm-transform.cjs
// turns only @nestjs/jwt into CommonJS). Its stand-in is also the wanted thing: the real one reads
// the .env files of whoever runs the tests, and all this spec asks the module for is the list of
// what it registers.
jest.mock('@nestjs/config', () => ({ ConfigModule: { forRoot: () => ({ module: class ConfigModule {} }) } }));

describe('AppModule', () => {
  const registered = Reflect.getMetadata('controllers', AppModule) as unknown[];

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
      ['ai', 'assignees', 'auth', 'branding', 'catalog', 'companies', 'dashboard', 'events', 'preferences', 'settings', 'support-types', 'tickets', 'transfer', 'users'].sort(),
    );
    // Each one once, and none registered that the search did not see.
    expect(new Set(registered).size).toBe(registered.length);
    expect(found).toHaveLength(registered.length);
  });
});
