import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { getMetadataStorage, validate } from 'class-validator';
import type { MetadataStorage, ValidationError } from 'class-validator';
import { configureApp } from '../app.setup';

// Loading AppModule loads @nestjs/config, published as ES modules only (see app.http.spec.ts).
jest.mock('@nestjs/config', () => ({ ConfigModule: { forRoot: () => ({ module: class ConfigModule {} }) } }));

type Rule = ReturnType<MetadataStorage['getTargetValidationMetadatas']>[number];
type Dto = ClassConstructor<object>;

const SRC = join(__dirname, '..');

/**
 * Every DTO class of the API: every source file is loaded (main.ts would start the API), and the
 * classes are the ones its decorators registered with class-validator, exported or not. A new DTO
 * is in the list without anyone adding it.
 */
function dtoClasses(): Dto[] {
  for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (file.endsWith('.ts') && !file.endsWith('.spec.ts') && file !== 'main.ts') jest.requireActual(join(SRC, file));
  }
  // Not part of the public API of class-validator: the map from each class to its rules.
  const storage = getMetadataStorage() as unknown as { validationMetadatas: Map<Dto | string, Rule[]> };
  return [...storage.validationMetadatas.keys()].filter((target): target is Dto => typeof target === 'function');
}

/** The pipe main.ts puts on every request, taken from `configureApp`. */
function appPipe(): PipeTransform {
  const pipes: PipeTransform[] = [];
  const app = {
    set: () => app,
    setGlobalPrefix: () => app,
    useBodyParser: () => app,
    use: () => app,
    useGlobalPipes: (...added: PipeTransform[]) => pipes.push(...added),
  };
  configureApp(app as unknown as NestExpressApplication, {});
  expect(pipes).toHaveLength(1);
  return pipes[0];
}

/**
 * Values that break each rule of class-validator used in a DTO. A rule that none of them breaks
 * fails the test below: add the value that breaks it here.
 */
const BREAKERS: Record<string, (rule: Rule) => unknown[]> = {
  isString: () => [12345],
  isBoolean: () => ['sí'],
  isInt: () => [1.5, 'uno'],
  isNumber: () => ['uno'],
  isEnum: () => ['NO_EXISTE'],
  isArray: () => ['x'],
  isObject: () => ['x'],
  minLength: (rule) => ['x'.repeat(Number(rule.constraints[0]) - 1)],
  maxLength: (rule) => ['x'.repeat(Number(rule.constraints[0]) + 1)],
  min: (rule) => [Number(rule.constraints[0]) - 1],
  max: (rule) => [Number(rule.constraints[0]) + 1],
  arrayMaxSize: (rule) => [Array.from({ length: Number(rule.constraints[0]) + 1 }, () => 1)],
  matches: () => ['¡no!'],
  nestedValidation: () => ['x', ['x'], [{}], [{ campoQueNoSeAdmite: 1 }]],
  isDateOnly: () => ['2026-02-30'],
  isTimeOnly: () => ['24:00'],
};
/** For a rule missing above. */
const ANY_BREAKER = ['x', 12345, '', true, [], {}, null, -1, 1.5, ['x']];

/** `IsOptional` and `Allow` are no rule a value can break. */
const breakable = (rule: Rule): boolean => rule.type !== 'conditionalValidation' && rule.type !== 'whitelistValidation';
const keyOf = (rule: Rule): string => rule.name ?? rule.type;

function valuesBreaking(rule: Rule): unknown[] {
  const values = BREAKERS[keyOf(rule)]?.(rule) ?? ANY_BREAKER;
  // A rule on each item of a list, other than nesting, gets its wrong value inside a list.
  return rule.each && keyOf(rule) !== 'nestedValidation' ? values.map((value) => [value]) : values;
}

interface Failure {
  path: string;
  key: string;
  message: string;
}

function flatten(errors: ValidationError[], parent?: string): Failure[] {
  return errors.flatMap((error) => {
    const path = parent === undefined ? error.property : `${parent}.${error.property}`;
    const own = Object.entries(error.constraints ?? {}).map(([key, message]) => ({ path, key, message }));
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

/** A body as the failures show it: a long text is a few hundred x. */
const brief = (body: object): string => JSON.stringify(body).replace(/x{20,}/g, (run) => `x × ${run.length}`);

/**
 * What class-validator answers on its own for this body, and which of those texts are its English
 * defaults: a rule whose text disappears with `dismissDefaultMessages` has none of its own, and
 * class-validator always writes the text of nesting and of a field not admitted itself.
 */
async function classValidatorAnswer(type: Dto, body: object): Promise<{ failures: Failure[]; defaults: string[] }> {
  const failures = flatten(await validate(plainToInstance(type, body), OPTIONS));
  const silent = flatten(await validate(plainToInstance(type, body), { ...OPTIONS, dismissDefaultMessages: true }));
  const defaults = failures
    .filter(({ path, key }) => key === 'nestedValidation' || key === 'whitelistValidation' || !silent.find((other) => other.path === path && other.key === key)?.message)
    .map(({ message }) => message);
  return { failures, defaults };
}

describe('the 400 of every DTO of the API', () => {
  const classes = dtoClasses();
  const pipe = appPipe();

  /** The messages of the 400 the API answers to this body, none when it accepts it. */
  async function answer(type: Dto, body: object): Promise<string[]> {
    try {
      await pipe.transform(body, { type: 'body', metatype: type });
      return [];
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return ((error as BadRequestException).getResponse() as { message: string[] }).message;
    }
  }

  it('are found by reading the source folder', () => {
    // The ones of today, which the search must find: a search that finds none would check nothing.
    expect(classes.map((type) => type.name)).toEqual(
      expect.arrayContaining([
        'LoginDto',
        'ChangePasswordDto',
        'CreateUserDto',
        'UpdateUserDto',
        'SaveConfigDto',
        'ModelsDto',
        'RemindersDto',
        'ModuleInput',
        'SlaInput',
        'SlaItem',
        'AssigneeInput',
        'CompanyInput',
        'SupportTypeInput',
        'PreferenceInput',
        'TicketInput',
        'NoteDto',
      ]),
    );
  });

  it('are Spanish, for a wrong value of each rule of each field, an empty body and a field not admitted', async () => {
    const problems: string[] = [];
    for (const type of classes) {
      const rules = getMetadataStorage().getTargetValidationMetadatas(type, '', true, false).filter(breakable);
      const bodies: object[] = [{}, { campoQueNoSeAdmite: 1 }];
      for (const rule of rules) for (const value of valuesBreaking(rule)) bodies.push({ [rule.propertyName]: value });

      const broken = new Set<string>();
      for (const body of bodies) {
        const { failures, defaults } = await classValidatorAnswer(type, body);
        failures.forEach(({ path, key }) => broken.add(`${path}:${key}`));
        const messages = await answer(type, body);
        const shown = brief(body);
        if (failures.length && !messages.length) problems.push(`${type.name} ${shown}: accepted`);
        for (const message of messages) {
          const english = defaults.find((text) => message.includes(text));
          if (english) problems.push(`${type.name} ${shown}: "${message}" is the English default "${english}"`);
        }
        if ('campoQueNoSeAdmite' in body && !messages.includes('El campo «campoQueNoSeAdmite» no se admite')) {
          problems.push(`${type.name} ${shown}: ${JSON.stringify(messages)} does not refuse the field`);
        }
      }
      for (const rule of rules) {
        const key = keyOf(rule);
        if (!broken.has(`${rule.propertyName}:${key}`)) problems.push(`${type.name}.${rule.propertyName}: no value of BREAKERS breaks ${key}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
