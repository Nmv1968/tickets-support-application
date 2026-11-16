import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import type { MetadataStorage, ValidationError } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';

type Rule = ReturnType<MetadataStorage['getTargetValidationMetadatas']>[number];

/** At most this many messages in one answer: a list of a thousand wrong items is not a thousand lines. */
export const MAX_MESSAGES = 20;
export const MORE_MESSAGES = 'Hay más errores en los datos enviados';
export const NOT_AN_OBJECT = 'Los datos enviados deben ser un objeto JSON';
export const MALFORMED_JSON = 'Los datos enviados no son un JSON válido';

/**
 * The rules that say what a value is, in order of preference. When one fails, the field gets
 * that message alone: a number sent for a name is not also "too short" and "too long".
 */
const KIND_RULES = ['isArray', 'isObject', 'isString', 'isInt', 'isNumber', 'isBoolean', 'isEnum', 'nestedValidation'];

const limit = (rule: Rule | undefined): number | undefined => rule?.constraints?.[0] as number | undefined;

/**
 * What each rule of class-validator asks, after "El campo «x»", for the rules without a message
 * of their own. A rule missing here, or whose limit cannot be read, says the value is not valid.
 */
const SENTENCES: Record<string, (rule: Rule | undefined) => string | undefined> = {
  isString: () => 'debe ser un texto',
  isBoolean: () => 'debe ser true o false',
  isInt: () => 'debe ser un número entero',
  isNumber: () => 'debe ser un número',
  isArray: () => 'debe ser una lista',
  isObject: () => 'debe ser un objeto',
  isNotEmpty: () => 'no puede estar vacío',
  isDefined: () => 'es obligatorio',
  matches: () => 'no tiene el formato esperado',
  isEnum: (rule) => (Array.isArray(rule?.constraints?.[1]) ? `debe ser uno de estos valores: ${(rule.constraints[1] as unknown[]).join(', ')}` : undefined),
  minLength: (rule) => {
    const min = limit(rule);
    if (min === undefined) return undefined;
    return min <= 1 ? 'no puede estar vacío' : `debe tener al menos ${min} caracteres`;
  },
  maxLength: (rule) => (limit(rule) === undefined ? undefined : `no puede tener más de ${limit(rule)} caracteres`),
  min: (rule) => (limit(rule) === undefined ? undefined : `no puede ser menor que ${limit(rule)}`),
  max: (rule) => (limit(rule) === undefined ? undefined : `no puede ser mayor que ${limit(rule)}`),
  arrayMinSize: (rule) => (limit(rule) === undefined ? undefined : `debe tener al menos ${limit(rule)} elementos`),
  arrayMaxSize: (rule) => (limit(rule) === undefined ? undefined : `no puede tener más de ${limit(rule)} elementos`),
};

/** The decorator behind a failed rule, found on the class of the object the field belongs to. */
function ruleOf(error: ValidationError, key: string): Rule | undefined {
  const target = error.target?.constructor;
  if (!target) return undefined;
  return getMetadataStorage()
    .getTargetValidationMetadatas(target, '', true, false)
    .find((rule) => rule.propertyName === error.property && (rule.name ?? rule.type) === key);
}

function message(error: ValidationError, path: string, key: string): string {
  // class-validator writes its English text into these two even with `dismissDefaultMessages`
  // (into nesting as if it were the decorator's own message), so they are always written here.
  if (key === 'whitelistValidation') return `El campo «${path}» no se admite`;
  const rule = ruleOf(error, key);
  if (key === 'nestedValidation') {
    // An item of a list, or a field that holds a list of objects (`each`), or one object.
    const list = !Array.isArray(error.target) && rule?.each;
    return `El campo «${path}» debe ser ${list ? 'una lista de objetos' : 'un objeto'}`;
  }
  // With `dismissDefaultMessages` the text is empty unless the decorator brings its own.
  const own = error.constraints?.[key];
  if (own) return own;
  const sentence = SENTENCES[key]?.(rule) ?? 'no es válido';
  return `${rule?.each ? 'Cada valor de' : 'El campo'} «${path}» ${sentence}`;
}

function fieldMessages(error: ValidationError, path: string): string[] {
  const failed = Object.keys(error.constraints ?? {});
  if (!failed.length) return [];
  // Only the check Nest adds itself, that the whole body is an object, comes without a target.
  if (!error.target) return [NOT_AN_OBJECT];
  if (failed.includes('whitelistValidation')) return [message(error, path, 'whitelistValidation')];
  if (error.value === undefined) return [`El campo «${path}» es obligatorio`];
  const kind = KIND_RULES.find((key) => failed.includes(key));
  return (kind ? [kind] : failed).map((key) => message(error, path, key));
}

/**
 * The 400 of a body that breaks the rules of its DTO, one Spanish sentence per problem, each
 * naming its field (`items.0.hours` inside a list). A decorator's own message is kept as written.
 */
export function validationMessages(errors: ValidationError[]): string[] {
  const messages = new Set<string>();
  let more = false;
  const visit = (error: ValidationError, parent?: string): void => {
    const path = parent === undefined ? error.property : `${parent}.${error.property}`;
    for (const text of fieldMessages(error, path)) {
      if (messages.size === MAX_MESSAGES && !messages.has(text)) more = true;
      else messages.add(text);
    }
    for (const child of error.children ?? []) {
      if (more) return;
      visit(child, path);
    }
  };
  for (const error of errors) {
    if (more) break;
    visit(error);
  }
  return more ? [...messages, MORE_MESSAGES] : [...messages];
}

/**
 * ValidationPipe that leaves the parameters of the path as they came. Its own conversion runs
 * before `IdPipe` and reads an id with `Number`, which takes "0x10" for 16, "1e3" for 1000 and " "
 * for 0: `IdPipe` would see a whole number and the request would reach another record, instead of
 * the 400 of an id that is not one. Every parameter of the path is a text, or an id read by `IdPipe`.
 */
class PathAsWrittenValidationPipe extends ValidationPipe {
  protected override transformPrimitive(value: unknown, metadata: ArgumentMetadata): unknown {
    return metadata.type === 'param' ? value : super.transformPrimitive(value, metadata);
  }
}

/**
 * The pipe every request goes through. Its options are those of before, and the answer of a body
 * that does not pass is Spanish: class-validator's own texts are English, so they are left out
 * (`dismissDefaultMessages`) and `validationMessages` writes them. The errors carry the object of
 * each field (`target`) so that the rules of its class can be read; they never reach the client.
 */
export function validationPipe(): ValidationPipe {
  return new PathAsWrittenValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    dismissDefaultMessages: true,
    validationError: { target: true, value: true },
    exceptionFactory: (errors) => new BadRequestException(validationMessages(errors)),
  });
}

/**
 * Express error handler for the JSON parser, placed right after it. Nest answers a body that is
 * not JSON with a 400 that carries the English text of `JSON.parse`; this one answers it in
 * Spanish. Every other error goes on as it came.
 */
export function malformedJsonInSpanish(error: unknown, _req: Request, _res: Response, next: NextFunction): void {
  const type = (error as { type?: unknown } | null)?.type;
  next(type === 'entity.parse.failed' ? new BadRequestException(MALFORMED_JSON) : error);
}
