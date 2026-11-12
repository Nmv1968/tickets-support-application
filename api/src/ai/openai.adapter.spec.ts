import { openAiAdapter } from './openai.adapter';
import type { AiRequest } from './types';

describe('openAiAdapter: where the requests go', () => {
  const ELSEWHERE = 'https://otro.example/v1';
  const request: AiRequest = { model: 'modelo-a', system: 'Sistema', text: 'Texto', images: [], json: false };
  let urls: string[];

  beforeEach(() => {
    urls = [];
    // One answer that serves both the list of models and a chat completion.
    jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response(JSON.stringify({ data: [], choices: [{ message: { content: 'Listo' } }] }), { status: 200 }));
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('calls api.openai.com for OpenAI, whatever base URL the credentials carry', async () => {
    const openAi = openAiAdapter(true);

    await openAi.listModels({ apiKey: 'sk-0000', baseUrl: ELSEWHERE });
    await openAi.complete({ apiKey: 'sk-0000', baseUrl: ELSEWHERE }, request);
    await openAi.listModels({ apiKey: 'sk-0000' });

    expect(urls).toEqual(['https://api.openai.com/v1/models', 'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/models']);
  });

  it('calls the configured server for a compatible provider', async () => {
    const compatible = openAiAdapter(false);

    await compatible.listModels({ apiKey: '', baseUrl: ' http://localhost:11434/v1/ ' });
    await compatible.complete({ apiKey: 'sk-0000', baseUrl: ELSEWHERE }, request);

    expect(urls).toEqual(['http://localhost:11434/v1/models', `${ELSEWHERE}/chat/completions`]);
  });

  it('does not fall back to api.openai.com when a compatible provider has no URL', async () => {
    const compatible = openAiAdapter(false);

    for (const baseUrl of [undefined, null, '', '  ']) {
      await expect(compatible.listModels({ apiKey: 'sk-0000', baseUrl })).rejects.toThrow('Falta la URL del servidor.');
      await expect(compatible.complete({ apiKey: 'sk-0000', baseUrl }, request)).rejects.toThrow('Falta la URL del servidor.');
    }
    expect(urls).toEqual([]);
  });

  it('accepts only http and https servers', async () => {
    const compatible = openAiAdapter(false);

    for (const baseUrl of ['ia.example/v1', 'ftp://ia.example/v1', 'file:///etc/hosts']) {
      await expect(compatible.listModels({ apiKey: 'sk-0000', baseUrl })).rejects.toThrow('La URL del servidor debe empezar con http:// o https://');
    }
    expect(urls).toEqual([]);
  });
});

describe('openAiAdapter: the list of models of a server that answers 200 with any JSON', () => {
  const cred = { apiKey: '', baseUrl: 'http://localhost:11434/v1' };
  const answerWith = (body: unknown): void => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
  };

  afterEach(() => jest.restoreAllMocks());

  it('skips what is not a model and keeps the rest, in order', async () => {
    answerWith({ data: [null, 'modelo-suelto', 7, ['modelo-c'], {}, { id: null }, { id: 7 }, { id: { nombre: 'x' } }, { id: '' }, { id: 'modelo-b' }, { id: 'modelo-a' }] });

    await expect(openAiAdapter(false).listModels(cred)).resolves.toEqual([
      { id: 'modelo-a', name: 'modelo-a', vision: null },
      { id: 'modelo-b', name: 'modelo-b', vision: null },
    ]);
  });

  it('gives an empty list when nothing in the answer is a model', async () => {
    const bodies = [{ data: 'modelo-a' }, { data: { id: 'modelo-a' } }, { data: 7 }, { data: null }, { data: [null, 7] }, {}, { models: [] }, [], 'ok', 7, null];

    for (const body of bodies) {
      answerWith(body);
      await expect(openAiAdapter(false).listModels(cred)).resolves.toEqual([]);
    }
  });
});
