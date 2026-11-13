import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROLLER_WATERMARK } from '@nestjs/common/constants';
import { AppModule } from './app.module';
import { CompaniesController } from './companies/companies.controller';
import { PreferencesController } from './preferences/preferences.controller';
import { SupportTypesController } from './support-types/support-types.controller';

// The two packages below are ES modules, which Jest does not load here. Their stand-ins have what
// the files of the API take from them. For the configuration it is also the wanted thing: the real
// one reads the .env files of whoever runs the tests, and all this spec asks the module for is the
// list of what it registers.
jest.mock('@nestjs/config', () => ({ ConfigModule: { forRoot: () => ({ module: class ConfigModule {} }) } }));
jest.mock('@nestjs/jwt', () => ({ JwtModule: { registerAsync: () => ({ module: class JwtModule {} }) }, JwtService: class JwtService {} }));

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
