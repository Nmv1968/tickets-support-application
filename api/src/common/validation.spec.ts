import { BadRequestException, HttpException } from '@nestjs/common';
import type { Type as ClassType } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { MALFORMED_JSON, MAX_MESSAGES, MORE_MESSAGES, NOT_AN_OBJECT, bodyErrorsInSpanish, validationPipe } from './validation';

enum Color {
  RED = 'RED',
  BLUE = 'BLUE',
}

class Item {
  @IsInt() @Min(1) @Max(10) hours!: number;
}

class Sample {
  @IsString() @MinLength(1) @MaxLength(5) name!: string;
  @IsOptional() @IsString() @MinLength(6) password?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsEnum(Color) color?: Color;
  @IsOptional() @IsInt() @Min(0) @Max(60) days?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(2) @IsInt({ each: true }) @Min(1, { each: true }) ids?: number[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => Item) items?: Item[];
  @IsOptional() @ValidateNested() @Type(() => Item) item?: Item;
  @IsOptional() @Matches(/^#[0-9a-f]{6}$/) hex?: string;
  @IsOptional() @MaxLength(3, { message: 'La nota no puede tener más de 3 caracteres' }) note?: string;
  @IsOptional() @IsInt({ each: true }) @Min(1, { each: true, message: 'El nivel no existe' }) @Max(9, { each: true, message: 'El nivel no existe' }) levels?: number[];
}

class AllOptional {
  @IsOptional() @IsString() text?: string;
}

const pipe = validationPipe();

/** The messages of the 400 the pipe answers to this body, none when it accepts it. */
async function answer(body: unknown, type: ClassType = Sample): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: type });
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    // The shape of every 400 of the API, which the web and the MCP server read.
    const { statusCode, error: name, message } = (error as BadRequestException).getResponse() as { statusCode: number; error: string; message: string[] };
    expect({ statusCode, name, list: Array.isArray(message) }).toEqual({ statusCode: 400, name: 'Bad Request', list: true });
    return message;
  }
}

describe('the answer of a body that breaks the rules of its DTO', () => {
  it('accepts a body that keeps them, as before', async () => {
    await expect(pipe.transform({ name: 'Ana', days: 3, items: [{ hours: 2 }] }, { type: 'body', metatype: Sample })).resolves.toEqual(
      Object.assign(new Sample(), { name: 'Ana', days: 3, items: [Object.assign(new Item(), { hours: 2 })] }),
    );
  });

  it('says in Spanish what each rule asks, naming the field', async () => {
    expect(await answer({ name: '' })).toEqual(['El campo «name» no puede estar vacío']);
    expect(await answer({ name: 'abcdef' })).toEqual(['El campo «name» no puede tener más de 5 caracteres']);
    expect(await answer({ name: 'Ana', password: 'corta' })).toEqual(['El campo «password» debe tener al menos 6 caracteres']);
    expect(await answer({ name: 'Ana', active: 'sí' })).toEqual(['El campo «active» debe ser true o false']);
    expect(await answer({ name: 'Ana', color: 'GREEN' })).toEqual(['El campo «color» debe ser uno de estos valores: RED, BLUE']);
    expect(await answer({ name: 'Ana', days: 1.5 })).toEqual(['El campo «days» debe ser un número entero']);
    expect(await answer({ name: 'Ana', days: -1 })).toEqual(['El campo «days» no puede ser menor que 0']);
    expect(await answer({ name: 'Ana', days: 61 })).toEqual(['El campo «days» no puede ser mayor que 60']);
    expect(await answer({ name: 'Ana', ids: 'x' })).toEqual(['El campo «ids» debe ser una lista']);
    expect(await answer({ name: 'Ana', ids: [1, 2, 3] })).toEqual(['El campo «ids» no puede tener más de 2 elementos']);
    expect(await answer({ name: 'Ana', hex: 'rojo' })).toEqual(['El campo «hex» no tiene el formato esperado']);
  });

  it('says it of each value of a list when the rule is on each one', async () => {
    expect(await answer({ name: 'Ana', ids: ['uno'] })).toEqual(['Cada valor de «ids» debe ser un número entero']);
    expect(await answer({ name: 'Ana', ids: [0] })).toEqual(['Cada valor de «ids» no puede ser menor que 1']);
  });

  it('says only what the value is not, when it is not what the field holds', async () => {
    // class-validator also finds a number neither empty enough nor too long: three messages.
    expect(await answer({ name: 12345 })).toEqual(['El campo «name» debe ser un texto']);
  });

  it('says that a field the body leaves out is required', async () => {
    expect(await answer({})).toEqual(['El campo «name» es obligatorio']);
  });

  it('keeps the message a decorator brings, once', async () => {
    expect(await answer({ name: 'Ana', note: 'abcd' })).toEqual(['La nota no puede tener más de 3 caracteres']);
    expect(await answer({ name: 'Ana', levels: [0, 10] })).toEqual(['El nivel no existe']);
  });

  it('refuses a field the DTO does not take', async () => {
    expect(await answer({ name: 'Ana', role: 'ADMIN' })).toEqual(['El campo «role» no se admite']);
  });

  it('names the field of an object inside the body by its path', async () => {
    expect(await answer({ name: 'Ana', items: [{ hours: 0 }, 'x', { hours: 1, extra: 1 }] })).toEqual([
      'El campo «items.0.hours» no puede ser menor que 1',
      'El campo «items.1» debe ser un objeto',
      'El campo «items.2.extra» no se admite',
    ]);
    expect(await answer({ name: 'Ana', item: 'x' })).toEqual(['El campo «item» debe ser un objeto']);
    expect(await answer({ name: 'Ana', item: {} })).toEqual(['El campo «item.hours» es obligatorio']);
  });

  it('says that the body must be an object, when it is a list', async () => {
    expect(await answer([], AllOptional)).toEqual([NOT_AN_OBJECT]);
  });

  it(`answers at most ${MAX_MESSAGES} messages, and says there are more`, async () => {
    const messages = await answer({ name: 'Ana', items: Array.from({ length: 30 }, () => 'x') });

    expect(messages).toHaveLength(MAX_MESSAGES + 1);
    expect(messages[0]).toBe('El campo «items.0» debe ser un objeto');
    expect(messages[MAX_MESSAGES - 1]).toBe(`El campo «items.${MAX_MESSAGES - 1}» debe ser un objeto`);
    expect(messages[MAX_MESSAGES]).toBe(MORE_MESSAGES);
  });
});

describe('the answer of a body the parser refuses', () => {
  /** What the handler passes on for `error`: the answer, as its status and body. */
  const answerTo = (error: unknown): unknown => {
    const next = jest.fn();
    bodyErrorsInSpanish(error, {} as never, {} as never, next);
    const [passed] = next.mock.calls[0] as [unknown];
    return passed instanceof HttpException ? { status: passed.getStatus(), body: passed.getResponse() } : passed;
  };
  /** An error as body-parser makes it (with http-errors): its English text, its status and its type. */
  const parserError = (message: string, status: number, type: string, extra: object = {}) =>
    Object.assign(new Error(message), { status, statusCode: status, type, expose: status < 500, ...extra });

  it('is a Spanish 400 for a body that is not JSON', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected end of JSON input'), { status: 400, type: 'entity.parse.failed' });

    expect(answerTo(parseError)).toEqual({ status: 400, body: new BadRequestException(MALFORMED_JSON).getResponse() });
  });

  // body-parser's own texts are English: "request entity too large", "unsupported charset "EBCDIC"".
  it.each([
    [
      'a body over the limit of 100 KB',
      parserError('request entity too large', 413, 'entity.too.large', { limit: 102_400, length: 204_800 }),
      413,
      'Payload Too Large',
      'Los datos enviados pesan más de 100 KB, lo máximo que el sistema recibe en una solicitud.',
    ],
    [
      'a body over a limit it does not say',
      parserError('request entity too large', 413, 'entity.too.large'),
      413,
      'Payload Too Large',
      'Los datos enviados pesan más de lo permitido, lo máximo que el sistema recibe en una solicitud.',
    ],
    [
      'a form with too many fields',
      parserError('too many parameters', 413, 'parameters.too.many'),
      413,
      'Payload Too Large',
      'Los datos enviados tienen más campos de los que el sistema recibe en una solicitud.',
    ],
    [
      'a form nested too deep',
      parserError('The input exceeded the depth', 400, 'querystring.parse.rangeError'),
      400,
      'Bad Request',
      'Los datos enviados tienen más niveles de los que el sistema lee.',
    ],
    [
      'a charset other than UTF-8',
      parserError('unsupported charset "EBCDIC"', 415, 'charset.unsupported', { charset: 'ebcdic' }),
      415,
      'Unsupported Media Type',
      'Los datos enviados están en una codificación de caracteres que el sistema no lee. Envíalos en UTF-8.',
    ],
    [
      'a compression it does not read',
      parserError('unsupported content encoding "compress"', 415, 'encoding.unsupported'),
      415,
      'Unsupported Media Type',
      'Los datos enviados están comprimidos de una forma que el sistema no lee.',
    ],
  ])('is in Spanish, with the status of the parser, for %s', (_case, error, status, name, message) => {
    expect(answerTo(error)).toEqual({ status, body: { statusCode: status, error: name, message } });
  });

  it('is a Spanish message with the status of the parser for any other refusal of a request', () => {
    expect(answerTo(parserError('request size did not match content length', 400, 'request.size.invalid'))).toEqual({
      status: 400,
      body: { statusCode: 400, message: 'No se pudieron leer los datos enviados.' },
    });
  });

  it('leaves a failure of the server, and any error that is not of the parser, as it came', () => {
    const serverFailure = parserError('stream encoding should not be set', 500, 'stream.encoding.set');
    const other = new Error('otra cosa');

    expect(answerTo(serverFailure)).toBe(serverFailure);
    expect(answerTo(other)).toBe(other);
  });
});
