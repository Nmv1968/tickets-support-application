import { AiError, cleanBaseUrl, httpJson, providerError } from './types';

describe('cleanBaseUrl', () => {
  it('gives one spelling to the same address', () => {
    expect(cleanBaseUrl('https://servidor.example/v1')).toBe('https://servidor.example/v1');
    expect(cleanBaseUrl('  https://servidor.example/v1/  ')).toBe('https://servidor.example/v1');
    expect(cleanBaseUrl('https://servidor.example/v1///')).toBe('https://servidor.example/v1');
  });

  it('reads an empty value as no URL', () => {
    expect(cleanBaseUrl('')).toBeNull();
    expect(cleanBaseUrl('   ')).toBeNull();
    expect(cleanBaseUrl('/')).toBeNull();
    expect(cleanBaseUrl(null)).toBeNull();
    expect(cleanBaseUrl(undefined)).toBeNull();
  });
});

describe('providerError', () => {
  it('shows the message the provider put in its JSON error', () => {
    expect(providerError(400, { error: { message: 'Modelo no soportado' } }).message).toBe(
      'El proveedor de IA respondió HTTP 400. Detalle: Modelo no soportado',
    );
    expect(providerError(400, { error: 'Solicitud inválida' }).message).toBe('El proveedor de IA respondió HTTP 400. Detalle: Solicitud inválida');
    expect(providerError(400, { message: 'Falta el modelo' }).message).toBe('El proveedor de IA respondió HTTP 400. Detalle: Falta el modelo');
  });

  it('cuts a long message', () => {
    const { message } = providerError(500, { error: { message: 'x'.repeat(1000) } });
    expect(message).toBe(`El proveedor de IA respondió HTTP 500. Detalle: ${'x'.repeat(300)}`);
  });

  it('shows nothing of a body that carries no error message', () => {
    const bare = 'El proveedor de IA respondió HTTP 500.';
    // `null` is what httpJson gives for a body that was not JSON; a string is a JSON body that is only text.
    for (const body of [null, undefined, 'clave interna', 42, ['clave interna'], { data: 'clave interna' }, { error: { code: 7 } }, { error: 7 }]) {
      expect(providerError(500, body).message).toBe(bare);
    }
  });

  it('names the failures a person can act on', () => {
    expect(providerError(401, null).message).toBe('El proveedor rechazó la API key (HTTP 401).');
    expect(providerError(403, null).message).toBe('El proveedor rechazó la API key (HTTP 403).');
    expect(providerError(404, null).message).toBe('El proveedor no encontró el modelo o la URL (HTTP 404).');
    expect(providerError(429, null).message).toBe('Límite de uso alcanzado en el proveedor (HTTP 429).');
  });
});

describe('httpJson', () => {
  const answerWith = (response: () => Promise<Response>): void => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(response);
  };

  afterEach(() => jest.restoreAllMocks());

  it('returns the status and the parsed JSON', async () => {
    answerWith(() => Promise.resolve(new Response('{"data":[1,2]}', { status: 200 })));
    await expect(httpJson('https://servidor.example/v1/models', {}, 1000)).resolves.toEqual({ status: 200, body: { data: [1, 2] } });
  });

  it('drops a body that is not JSON instead of returning its text', async () => {
    answerWith(() => Promise.resolve(new Response('<html>panel interno: clave 1234</html>', { status: 502 })));
    await expect(httpJson('http://10.0.0.5/admin', {}, 1000)).resolves.toEqual({ status: 502, body: null });
  });

  it('turns a failed connection into a message for the user', async () => {
    answerWith(() => Promise.reject(new TypeError('fetch failed')));
    const error = await httpJson('https://servidor.example/v1/models', {}, 1000).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).message).toBe('No se pudo conectar con el proveedor de IA (sin conexión).');
  });

  it('says so when the provider did not answer in time', async () => {
    answerWith(() => Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })));
    await expect(httpJson('https://servidor.example/v1/models', {}, 1000)).rejects.toThrow(
      'No se pudo conectar con el proveedor de IA (tiempo de espera agotado).',
    );
  });

  describe('when the answer breaks off after its headers', () => {
    /** A 200 whose body sends its first bytes and then fails with `error`, as fetch does when the body cannot be finished. */
    const brokenBody = (error: Error): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":['));
            controller.error(error);
          },
        }),
        { status: 200 },
      );

    it.each([
      ['the time runs out', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'tiempo de espera agotado'],
      ['the connection drops', new TypeError('terminated'), 'sin conexión'],
    ])('gives the same message for the user when %s', async (_case, bodyError, reason) => {
      answerWith(() => Promise.resolve(brokenBody(bodyError)));

      const error = await httpJson('https://servidor.example/v1/models', {}, 1000).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).message).toBe(`No se pudo conectar con el proveedor de IA (${reason}).`);
    });
  });
});
