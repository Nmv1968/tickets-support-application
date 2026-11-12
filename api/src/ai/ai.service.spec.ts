import { NotFoundException } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '../common/crypto';
import type { PrismaService } from '../prisma.service';
import type { TicketsService } from '../tickets/tickets.service';
import { AiService, draftFromAnswer } from './ai.service';
import type { SaveConfigInput } from './ai.service';
import { AiError } from './types';
import type { ProviderId } from './types';

// The key that encrypts the stored API keys. A value for these tests only.
process.env.APP_SECRET = 'solo-para-las-pruebas';

interface ConfigRow {
  provider: string;
  apiKeyEnc: string | null;
  baseUrl: string | null;
  model: string | null;
  active: boolean;
}

type ConfigData = Partial<ConfigRow>;

interface StoredCase {
  id: number;
  company: string;
  date: Date;
  status: 'UNRESOLVED' | 'PENDING' | 'RESOLVED';
  description: string;
  module: { name: string } | null;
  notes: { text: string; createdAt: Date }[];
}

/** Like Prisma, a field left undefined is not written. */
function written(data: ConfigData): ConfigData {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

/** The part of PrismaService the AI service uses, kept in memory. */
class FakePrisma {
  readonly rows = new Map<string, ConfigRow>();
  cases: StoredCase[] = [];
  modules: { id: number; name: string; parent: { name: string } | null }[] = [];

  readonly aiProviderConfig = {
    findMany: (): Promise<ConfigRow[]> => Promise.resolve([...this.rows.values()]),
    findUnique: (args: { where: { provider: string } }): Promise<ConfigRow | null> => Promise.resolve(this.rows.get(args.where.provider) ?? null),
    findFirst: (): Promise<ConfigRow | null> => Promise.resolve([...this.rows.values()].find((row) => row.active) ?? null),
    updateMany: (args: { data: { active: boolean } }): Promise<void> => {
      for (const row of this.rows.values()) row.active = args.data.active;
      return Promise.resolve();
    },
    upsert: (args: { where: { provider: string }; create: ConfigData; update: ConfigData }): Promise<void> => {
      const { provider } = args.where;
      const existing = this.rows.get(provider);
      this.rows.set(
        provider,
        existing
          ? { ...existing, ...written(args.update) }
          : { apiKeyEnc: null, baseUrl: null, model: null, active: false, ...written(args.create), provider },
      );
      return Promise.resolve();
    },
  };

  readonly ticket = {
    findUnique: (args: { where: { id: number } }): Promise<StoredCase | null> =>
      Promise.resolve(this.cases.find((stored) => stored.id === args.where.id) ?? null),
  };

  readonly systemModule = {
    findMany: (): Promise<FakePrisma['modules']> => Promise.resolve(this.modules),
  };

  /**
   * A test puts a promise here to hold the next transaction between its read and its writes
   * until the promise resolves. That is where another save can commit in the real database:
   * the read takes no lock, and the writes that come after it land on whatever the row holds by then.
   */
  holdAfterRead: Promise<void> | null = null;

  $transaction<T>(run: (tx: Pick<FakePrisma, 'aiProviderConfig'>) => Promise<T>): Promise<T> {
    const hold = this.holdAfterRead;
    this.holdAfterRead = null;
    if (!hold) return run(this);
    const findUnique: FakePrisma['aiProviderConfig']['findUnique'] = async (args) => {
      const row = await this.aiProviderConfig.findUnique(args);
      // A copy, so what this transaction read stays as it was whatever is written meanwhile.
      const seen = row && { ...row };
      await hold;
      return seen;
    };
    return run({ aiProviderConfig: { ...this.aiProviderConfig, findUnique } });
  }
}

const STORED_KEY = 'sk-guardada-0000';
const TYPED_KEY = 'sk-escrita-1111';
/** The URL the stored key of the compatible provider was saved with. */
const HOME = 'https://ia.example/api/v1';
const ELSEWHERE = 'https://otro.example/v1';

/** A stored provider row. `apiKey` is stored encrypted, as the service does. */
function stored(provider: ProviderId, values: { apiKey?: string; baseUrl?: string; model?: string; active?: boolean } = {}): ConfigRow {
  return {
    provider,
    apiKeyEnc: values.apiKey ? encryptSecret(values.apiKey) : null,
    baseUrl: values.baseUrl ?? null,
    model: values.model ?? null,
    active: values.active ?? false,
  };
}

function setup(...rows: ConfigRow[]) {
  const prisma = new FakePrisma();
  for (const row of rows) prisma.rows.set(row.provider, row);
  const savedReplies: { id: number; reply: string | null }[] = [];
  const tickets = {
    saveCustomerReply: (id: number, reply: string | null): Promise<void> => {
      savedReplies.push({ id, reply });
      return Promise.resolve();
    },
  };
  const service = new AiService(prisma as unknown as PrismaService, tickets as unknown as TicketsService);
  return { prisma, savedReplies, service };
}

/** Every request the service tried to send, in order. Nothing leaves the process. */
interface SentRequest {
  url: string;
  /** The Authorization header, which is where the key travels to these providers. */
  authorization: string | null;
  body: unknown;
}
let sent: SentRequest[];
/** What the provider answers. Each test that needs something else replaces it. */
let answer: () => Response;

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const modelList = (): Response => json(200, { data: [{ id: 'modelo-b' }, { id: 'modelo-a' }] });
const chatAnswer = (content: string): Response => json(200, { choices: [{ message: { content } }] });

beforeEach(() => {
  sent = [];
  answer = modelList;
  jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    sent.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(answer());
  });
});

afterEach(() => jest.restoreAllMocks());

/** The text of the user message of a chat request, where the service puts the data of the case. */
function userText(request: SentRequest): string {
  return (request.body as { messages: { content: { text: string }[] }[] }).messages[1].content[0].text;
}

async function failure(action: Promise<unknown>): Promise<AiError> {
  const error = await action.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

describe('where an API key may be sent', () => {
  describe('provider with a fixed address', () => {
    it('ignores a base URL sent with the request', async () => {
      const { service } = setup(stored('openai', { apiKey: STORED_KEY }));

      await service.models('openai', { baseUrl: ELSEWHERE });

      expect(sent).toEqual([{ url: 'https://api.openai.com/v1/models', authorization: `Bearer ${STORED_KEY}`, body: undefined }]);
    });

    it('ignores a base URL that an older version stored on its row', async () => {
      const { service } = setup(stored('openai', { apiKey: STORED_KEY, baseUrl: ELSEWHERE, model: 'modelo-a' }));
      answer = () => chatAnswer('{"color": "rojo"}');

      await service.models('openai', {});
      await service.test('openai');

      expect(sent.map((request) => request.url)).toEqual(['https://api.openai.com/v1/models', 'https://api.openai.com/v1/chat/completions']);
      expect((await service.config()).find((p) => p.id === 'openai')?.baseUrl).toBeNull();
    });

    it('asks for the key when there is none', async () => {
      const { service } = setup();

      expect((await failure(service.models('openai', {}))).message).toBe('Falta la API key de este proveedor.');
      expect(sent).toEqual([]);
    });
  });

  describe('provider with its own server URL', () => {
    it('uses the stored key against the URL it was saved with, however that URL is written', async () => {
      const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME }));

      await service.models('compatible', {});
      await service.models('compatible', { baseUrl: HOME });
      await service.models('compatible', { baseUrl: `  ${HOME}/ `, apiKey: '   ' });

      expect(sent).toHaveLength(3);
      for (const request of sent) expect(request).toMatchObject({ url: `${HOME}/models`, authorization: `Bearer ${STORED_KEY}` });
    });

    it('does not send the stored key to any other URL', async () => {
      const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME }));
      const others = [
        ELSEWHERE,
        'http://ia.example/api/v1',
        'https://ia.example:8443/api/v1',
        'https://ia.example/api/v1/otra',
        'https://ia.example.otro.example/api/v1',
        'https://ia.example@otro.example/api/v1',
        'http://127.0.0.1:11434/v1',
      ];

      for (const baseUrl of others) {
        const error = await failure(service.models('compatible', { baseUrl }));
        expect(error.message).toContain('La API key guardada es de otra URL');
      }
      expect(sent).toEqual([]);
    });

    it('sends the key typed with a new URL, not the stored one', async () => {
      const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME }));

      const models = await service.models('compatible', { apiKey: TYPED_KEY, baseUrl: ELSEWHERE });

      expect(sent).toEqual([{ url: `${ELSEWHERE}/models`, authorization: `Bearer ${TYPED_KEY}`, body: undefined }]);
      expect(models.map((model) => model.id)).toEqual(['modelo-a', 'modelo-b']);
    });

    it('reaches a local server that needs no key', async () => {
      const { service } = setup();

      await service.models('compatible', { baseUrl: 'http://localhost:11434/v1' });

      expect(sent).toEqual([{ url: 'http://localhost:11434/v1/models', authorization: null, body: undefined }]);
    });

    it('asks for the URL when there is none', async () => {
      const { service } = setup(stored('compatible', { apiKey: STORED_KEY }));

      expect((await failure(service.models('compatible', {}))).message).toBe('Falta la URL del servidor.');
      expect((await failure(service.models('compatible', { baseUrl: '  ', apiKey: TYPED_KEY }))).message).toBe('Falta la URL del servidor.');
      expect(sent).toEqual([]);
    });
  });
});

describe('saving a provider', () => {
  const compatible = async (service: AiService) => (await service.config()).find((p) => p.id === 'compatible');

  it('drops the stored key when the URL changes and no key comes with it', async () => {
    const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME, model: 'modelo-a' }));
    answer = () => chatAnswer('{"color": "rojo"}');

    await service.save('compatible', { baseUrl: ELSEWHERE });

    expect(await compatible(service)).toMatchObject({ hasKey: false, keyHint: null, baseUrl: ELSEWHERE, model: 'modelo-a' });
    // The new URL is now the stored one, and the calls that follow reach it without the old key.
    await service.models('compatible', {});
    await service.test('compatible');
    expect(sent.map((request) => request.url)).toEqual([`${ELSEWHERE}/models`, `${ELSEWHERE}/chat/completions`]);
    expect(sent.map((request) => request.authorization)).toEqual([null, null]);
  });

  it('drops a key that was saved before any URL when the first URL arrives', async () => {
    const { service } = setup(stored('compatible', { apiKey: STORED_KEY }));

    await service.save('compatible', { baseUrl: ELSEWHERE });

    expect(await compatible(service)).toMatchObject({ hasKey: false, baseUrl: ELSEWHERE });
  });

  it('stores the key that comes with a new URL', async () => {
    const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME }));

    await service.save('compatible', { apiKey: ` ${TYPED_KEY} `, baseUrl: ELSEWHERE });

    expect(await compatible(service)).toMatchObject({ hasKey: true, keyHint: '…1111', baseUrl: ELSEWHERE });
    await service.models('compatible', {});
    expect(sent).toEqual([{ url: `${ELSEWHERE}/models`, authorization: `Bearer ${TYPED_KEY}`, body: undefined }]);
  });

  it('keeps the key when the URL is the same one written differently', async () => {
    const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: `${HOME}/` }));

    await service.save('compatible', { baseUrl: ` ${HOME} `, model: ' modelo-b ' });

    expect(await compatible(service)).toMatchObject({ hasKey: true, keyHint: '…0000', baseUrl: HOME, model: 'modelo-b' });
  });

  it('keeps the key and the URL when neither is sent', async () => {
    const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME }));

    await service.save('compatible', { model: 'modelo-b' });

    expect(await compatible(service)).toMatchObject({ hasKey: true, keyHint: '…0000', baseUrl: HOME, model: 'modelo-b' });
  });

  it('removes the key on an empty one and keeps the rest', async () => {
    const { service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME, model: 'modelo-a' }));

    await service.save('compatible', { apiKey: '', active: false });

    expect(await compatible(service)).toMatchObject({ hasKey: false, keyHint: null, baseUrl: HOME, model: 'modelo-a' });
  });

  it('never stores a URL for a provider with a fixed address, and its key stays', async () => {
    const { prisma, service } = setup(stored('openai', { apiKey: STORED_KEY, baseUrl: ELSEWHERE }));

    await service.save('openai', { baseUrl: 'https://tercero.example/v1', model: 'modelo-a' });

    expect(prisma.rows.get('openai')?.baseUrl).toBeNull();
    expect((await service.config()).find((p) => p.id === 'openai')).toMatchObject({ hasKey: true, keyHint: '…0000', baseUrl: null });
  });

  it('creates the row of a provider saved for the first time', async () => {
    const { service } = setup();

    await service.save('compatible', { apiKey: TYPED_KEY, baseUrl: `${HOME}/`, model: 'modelo-a', active: true });

    expect(await compatible(service)).toMatchObject({ hasKey: true, keyHint: '…1111', baseUrl: HOME, model: 'modelo-a', active: true });
  });

  it('leaves one provider active', async () => {
    const { service } = setup(stored('openai', { apiKey: STORED_KEY, active: true }), stored('compatible', { baseUrl: HOME }));

    await service.save('compatible', { active: true });

    const active = (await service.config()).filter((p) => p.active).map((p) => p.id);
    expect(active).toEqual(['compatible']);
  });

  it('reads a null "active" as not sent: the provider stays as it was', async () => {
    const { prisma, service } = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME, active: true }));

    await service.save('compatible', { model: 'modelo-b', active: null as unknown as undefined });

    expect(prisma.rows.get('compatible')?.active).toBe(true);
    expect(await compatible(service)).toMatchObject({ active: true, model: 'modelo-b', hasKey: true });
  });
});

describe('two saves of the same provider at the same moment', () => {
  type Context = ReturnType<typeof setup>;

  // In these cases a key always travels with its URL, as the settings screen sends it:
  // the stored key is the one of HOME, and the typed key is only ever sent with ELSEWHERE.
  const sentWith: Record<string, string> = { [STORED_KEY]: HOME, [TYPED_KEY]: ELSEWHERE };

  /** What the row holds when its key sits next to a URL that key was not sent with. Null when all is well. */
  const mispaired = (prisma: FakePrisma): string | null => {
    const row = prisma.rows.get('compatible');
    if (!row?.apiKeyEnc) return null;
    const key = decryptSecret(row.apiKeyEnc);
    return row.baseUrl === sentWith[key] ? null : `${key} con ${row.baseUrl}`;
  };

  /** One save after the other. Gives what `mispaired` saw after each. */
  const inTurn = async ({ prisma, service }: Context, first: SaveConfigInput, second: SaveConfigInput): Promise<(string | null)[]> => {
    await service.save('compatible', first);
    const afterFirst = mispaired(prisma);
    await service.save('compatible', second);
    return [afterFirst, mispaired(prisma)];
  };

  /** `first` reads the row, then all of `second` runs, then `first` writes. Gives what `mispaired` saw after each write. */
  const overlapped = async ({ prisma, service }: Context, first: SaveConfigInput, second: SaveConfigInput): Promise<(string | null)[]> => {
    let release = (): void => undefined;
    prisma.holdAfterRead = new Promise<void>((resolve) => (release = resolve));
    const held = service.save('compatible', first);
    await service.save('compatible', second);
    const afterSecond = mispaired(prisma);
    release();
    await held;
    return [afterSecond, mispaired(prisma)];
  };

  it('does not put the URL of a save that read the row earlier under a key stored meanwhile', async () => {
    // The row already points at another server, without a key. Someone sends that same URL again
    // while the person who knows the key saves it with the right URL, as the settings screen does.
    const context = setup(stored('compatible', { baseUrl: ELSEWHERE, model: 'modelo-a' }));

    await overlapped(context, { baseUrl: ELSEWHERE }, { apiKey: STORED_KEY, baseUrl: HOME, model: 'modelo-a', active: true });

    expect(context.prisma.rows.get('compatible')?.baseUrl).toBe(HOME);
    await context.service.models('compatible', {});
    expect(sent).toEqual([{ url: `${HOME}/models`, authorization: `Bearer ${STORED_KEY}`, body: undefined }]);
  });

  it('does not put back the old URL under a key stored meanwhile for a new one', async () => {
    // Nobody means harm here: one person saves only the model while another changes server and key.
    const context = setup(stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME, model: 'modelo-a' }));

    await overlapped(context, { model: 'modelo-b' }, { apiKey: TYPED_KEY, baseUrl: ELSEWHERE });

    expect(await context.service.config().then((list) => list.find((p) => p.id === 'compatible'))).toMatchObject({
      keyHint: '…1111',
      baseUrl: ELSEWHERE,
      model: 'modelo-b',
    });
  });

  // Two saves can only meet in four ways: one after the other, either first, or both reading
  // the row before either writes, with either writing last. The database makes the second writer
  // wait for the first to commit, so nothing finer than that can happen.
  const saves: SaveConfigInput[] = [
    { apiKey: TYPED_KEY, baseUrl: ELSEWHERE, model: 'modelo-b', active: true },
    { apiKey: STORED_KEY, baseUrl: HOME },
    { baseUrl: ELSEWHERE },
    { baseUrl: HOME },
    { baseUrl: '' },
    { model: 'modelo-b' },
    { active: true },
    { apiKey: '' },
  ];
  const starts: [string, () => ConfigRow[]][] = [
    ['was never saved', () => []],
    ['holds a key and its URL', () => [stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME, model: 'modelo-a', active: true })]],
    ['holds that URL and no key', () => [stored('compatible', { baseUrl: HOME })]],
    ['holds another URL and no key', () => [stored('compatible', { baseUrl: ELSEWHERE })]],
  ];

  it.each(starts)('never leaves a key next to a URL it was not sent with, in any order: row that %s', async (_start, rows) => {
    const broken: string[] = [];
    for (const first of saves) {
      for (const second of saves) {
        for (const order of [inTurn, overlapped]) {
          const seen = await order(setup(...rows()), first, second);
          for (const pair of seen) {
            if (pair) broken.push(`${order.name} ${JSON.stringify(first)} + ${JSON.stringify(second)}: ${pair}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('what a failed call tells the user', () => {
  it('does not repeat a body that is not JSON', async () => {
    const { service } = setup();
    answer = () => new Response('<html>panel interno: clave 1234</html>', { status: 500 });

    const error = await failure(service.models('compatible', { baseUrl: 'http://10.0.0.5:8080' }));

    expect(error.message).toBe('El proveedor de IA respondió HTTP 500.');
  });

  it('repeats only the error message of a JSON body', async () => {
    const { service } = setup();
    answer = () => json(401, { error: { message: 'Clave incorrecta', internal: 'clave 1234' }, debug: 'panel interno' });

    const error = await failure(service.models('compatible', { baseUrl: HOME, apiKey: TYPED_KEY }));

    expect(error.message).toBe('El proveedor rechazó la API key (HTTP 401). Detalle: Clave incorrecta');
  });

  it('lists no models when a server answers 200 with something that is not JSON', async () => {
    const { service } = setup();
    answer = () => new Response('<html>Bienvenido</html>', { status: 200 });

    await expect(service.models('compatible', { baseUrl: HOME })).resolves.toEqual([]);
  });
});

describe('draftFromAnswer', () => {
  const modules = [
    { id: 3, name: 'Ventas > Facturación' },
    { id: 9, name: 'Inventario' },
  ];
  const TODAY = '2026-11-11';
  const draft = (fields: Record<string, unknown>) => draftFromAnswer(JSON.stringify({ description: 'Error al facturar', ...fields }), modules, TODAY);

  it('reads every field of a complete answer', () => {
    const raw = JSON.stringify({
      reportDate: '2026-11-10',
      company: ' ACME S.A. ',
      description: ' Error al guardar cierres especiales ',
      errorText: 'Violación de llave única',
      module: 'Inventario',
      priority: 'HIGH',
      estimatedMinutes: 45,
      note: 'Usuario jperez, documento 001-002-000000123',
    });

    expect(draftFromAnswer(raw, modules, TODAY)).toEqual({
      date: '2026-11-10',
      company: 'ACME S.A.',
      description: 'Error al guardar cierres especiales',
      moduleId: 9,
      priority: 'HIGH',
      estimatedMinutes: 45,
      note: 'Mensaje de error: Violación de llave única\nUsuario jperez, documento 001-002-000000123',
    });
  });

  it('finds the object inside a code fence or between other text', () => {
    const fenced = '```json\n{"description": "No abre el sistema", "priority": "CRITICAL"}\n```';
    const chatty = 'Claro, aquí está el caso:\n{"description": "No abre el sistema", "priority": "CRITICAL"}\nEspero que sirva.';

    for (const raw of [fenced, chatty]) {
      expect(draftFromAnswer(raw, modules, TODAY)).toMatchObject({ description: 'No abre el sistema', priority: 'CRITICAL' });
    }
  });

  it('rejects an answer without a JSON object', () => {
    for (const raw of ['', 'No puedo ayudar con eso.', '["Error al facturar"]', '{"description": "Error al fact', '{ descripción: sin comillas }']) {
      expect(() => draftFromAnswer(raw, modules, TODAY)).toThrow(AiError);
    }
  });

  it('rejects an answer without a description', () => {
    for (const description of [undefined, null, '', '   ', 42, ['Error al facturar']]) {
      expect(() => draftFromAnswer(JSON.stringify({ description, company: 'ACME' }), modules, TODAY)).toThrow(
        'El modelo no pudo describir el caso. Intenta con otra imagen o agrega texto.',
      );
    }
  });

  it('leaves empty what the model did not send', () => {
    expect(draft({})).toEqual({
      date: null,
      company: null,
      description: 'Error al facturar',
      moduleId: null,
      priority: null,
      estimatedMinutes: null,
      note: null,
    });
  });

  it('cuts each text to the size of its field', () => {
    const result = draft({ description: 'd'.repeat(3000), company: 'c'.repeat(300), note: 'n'.repeat(3000) });

    expect(result.description).toHaveLength(2000);
    expect(result.company).toHaveLength(200);
    expect(result.note).toHaveLength(2000);
  });

  it('reads as empty a text field that is not text', () => {
    expect(draft({ company: 42, note: ['a', 'b'], errorText: { code: 1 }, module: 3, reportDate: 20261110 })).toMatchObject({
      company: null,
      note: null,
      moduleId: null,
      date: null,
    });
  });

  it('finds the module by its full name, whatever the case', () => {
    expect(draft({ module: 'ventas > facturación' }).moduleId).toBe(3);
    expect(draft({ module: ' INVENTARIO ' }).moduleId).toBe(9);
    expect(draft({ module: 'Facturación' }).moduleId).toBeNull();
    expect(draft({ module: 'Nómina' }).moduleId).toBeNull();
  });

  it('accepts only the four priorities as they are written', () => {
    expect(draft({ priority: 'LOW' }).priority).toBe('LOW');
    expect(draft({ priority: 'CRITICAL' }).priority).toBe('CRITICAL');
    expect(draft({ priority: 'critical' }).priority).toBeNull();
    expect(draft({ priority: 'URGENTE' }).priority).toBeNull();
    expect(draft({ priority: 3 }).priority).toBeNull();
  });

  it('keeps the estimate only when it is a positive number', () => {
    expect(draft({ estimatedMinutes: 45 }).estimatedMinutes).toBe(45);
    expect(draft({ estimatedMinutes: '90' }).estimatedMinutes).toBe(90);
    expect(draft({ estimatedMinutes: 12.6 }).estimatedMinutes).toBe(13);
    expect(draft({ estimatedMinutes: 5_000_000 }).estimatedMinutes).toBe(100_000);
    for (const estimatedMinutes of [0, -30, 'dos horas', null]) {
      expect(draft({ estimatedMinutes }).estimatedMinutes).toBeNull();
    }
  });

  it('accepts as the reported day only a real day that is not in the future', () => {
    expect(draft({ reportDate: '2026-11-10' }).date).toBe('2026-11-10');
    expect(draft({ reportDate: TODAY }).date).toBe(TODAY);
    expect(draft({ reportDate: '2024-02-29' }).date).toBe('2024-02-29');
    for (const reportDate of ['2026-11-12', '2026-02-30', '2026-13-01', '10/11/2026', '2026-1-5', 'ayer']) {
      expect(draft({ reportDate }).date).toBeNull();
    }
  });

  it('puts the error message before the note', () => {
    expect(draft({ errorText: 'Timeout', note: 'Pantalla de cobros' }).note).toBe('Mensaje de error: Timeout\nPantalla de cobros');
    expect(draft({ errorText: 'Timeout' }).note).toBe('Mensaje de error: Timeout');
    expect(draft({ note: 'Pantalla de cobros' }).note).toBe('Pantalla de cobros');
  });
});

describe('drafting with the active provider', () => {
  const active = stored('compatible', { apiKey: STORED_KEY, baseUrl: HOME, model: 'modelo-a', active: true });

  it('drafts a case with the stored key and names the provider and the model', async () => {
    const { prisma, service } = setup(active);
    prisma.modules = [{ id: 3, name: 'Facturación', parent: { name: 'Ventas' } }];
    answer = () => chatAnswer('{"description": "No imprime la factura", "module": "Ventas > Facturación"}');

    const draft = await service.analyze('No me imprime la factura', []);

    expect(draft).toMatchObject({ description: 'No imprime la factura', moduleId: 3, provider: 'compatible', model: 'modelo-a' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `${HOME}/chat/completions`, authorization: `Bearer ${STORED_KEY}` });
  });

  describe('message for the client', () => {
    const resolvedCase: StoredCase = {
      id: 7,
      company: 'ACME',
      // A case date is a calendar day, stored at UTC midnight.
      date: new Date('2026-11-09T00:00:00.000Z'),
      status: 'RESOLVED',
      description: 'No imprime la factura',
      module: null,
      // Moments, built from local time. Read as UTC days, in any zone away from UTC
      // one of the two falls on the day before or the day after.
      notes: [
        { text: 'Se revisó la impresora', createdAt: new Date(2026, 10, 10, 0, 30) },
        { text: 'Se reinstaló el controlador', createdAt: new Date(2026, 10, 10, 23, 30) },
      ],
    };

    it('dates each note with the local day it was written and the case with its calendar day', async () => {
      const { prisma, service } = setup(active);
      prisma.cases = [resolvedCase];
      answer = () => chatAnswer('Buen día. El caso quedó resuelto.');

      await service.reply(7);

      const text = userText(sent[0]);
      expect(text).toContain('Fecha en que el cliente lo reportó: 09/11/2026');
      expect(text).toContain('- 10/11/2026: Se revisó la impresora\n- 10/11/2026: Se reinstaló el controlador');
    });

    it('saves the message through the tickets service, without the quotes a model may add', async () => {
      const { prisma, savedReplies, service } = setup(active);
      prisma.cases = [resolvedCase];
      answer = () => chatAnswer('"Buen día.\nEl caso SOP-00007 quedó resuelto."\n');

      await service.reply(7);

      expect(savedReplies).toEqual([{ id: 7, reply: 'Buen día.\nEl caso SOP-00007 quedó resuelto.' }]);
    });

    it('saves nothing when the model returns no message', async () => {
      const { prisma, savedReplies, service } = setup(active);
      prisma.cases = [resolvedCase];
      answer = () => chatAnswer('""');

      expect((await failure(service.reply(7))).message).toBe('El modelo no devolvió ningún mensaje. Intenta de nuevo.');
      expect(savedReplies).toEqual([]);
    });

    it('answers "not found" for a case that does not exist, and calls no provider', async () => {
      const { savedReplies, service } = setup(active);

      const error = await service.reply(99).catch((caught: unknown) => caught);

      // A 404 like the rest of the API, not the 422 of a problem with the provider.
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect((error as NotFoundException).message).toBe('El caso no existe');
      expect(sent).toEqual([]);
      expect(savedReplies).toEqual([]);
    });
  });
});
