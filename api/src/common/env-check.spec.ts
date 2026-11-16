import { MIN_SECRET_LENGTH, checkEnv } from './env-check';

// 32 characters each, the least a secret may have.
const VALID = { JWT_SECRET: 'a-long-random-string-of-32-chars', APP_SECRET: 'another-random-string-32-chars!!', ADMIN_PASSWORD: 'not-the-example' };

describe('checkEnv', () => {
  it('accepts real values, with or without the optional passwords', () => {
    expect(checkEnv({ ...VALID, NODE_ENV: 'production' })).toEqual({ errors: [], warnings: [] });
    expect(checkEnv({ JWT_SECRET: VALID.JWT_SECRET, APP_SECRET: VALID.APP_SECRET, MCP_PASSWORD: '' })).toEqual({ errors: [], warnings: [] });
  });

  it.each(['JWT_SECRET', 'APP_SECRET'])('refuses to start without %s, in any environment', (name) => {
    for (const NODE_ENV of ['production', 'development', undefined]) {
      for (const value of [undefined, '', '   ']) {
        const { errors } = checkEnv({ ...VALID, NODE_ENV, [name]: value });
        expect(errors).toEqual([`Falta definir ${name} en el archivo .env. Usa una cadena larga y aleatoria.`]);
      }
    }
  });

  it('names every missing secret in one message', () => {
    expect(checkEnv({}).errors).toEqual(['Falta definir JWT_SECRET y APP_SECRET en el archivo .env. Usa una cadena larga y aleatoria.']);
  });

  it.each(['JWT_SECRET', 'APP_SECRET', 'ADMIN_PASSWORD', 'MCP_PASSWORD'])(
    'refuses to start in production while %s has the value of .env.example',
    (name) => {
      expect(checkEnv({ ...VALID, NODE_ENV: 'production', [name]: 'change-me' })).toEqual({
        errors: [`Con el valor de ejemplo "change-me" de .env.example: ${name}. Cambia cada valor en el archivo .env.`],
        warnings: [],
      });
    },
  );

  it('only warns about the example values outside production', () => {
    const env = { JWT_SECRET: 'change-me', APP_SECRET: 'change-me', ADMIN_PASSWORD: 'change-me', MCP_PASSWORD: 'change-me' };
    const warnings = [
      'Con el valor de ejemplo "change-me" de .env.example: JWT_SECRET, APP_SECRET, ADMIN_PASSWORD, MCP_PASSWORD. ' +
        'En producción la API no inicia con ese valor.',
    ];
    expect(checkEnv(env)).toEqual({ errors: [], warnings });
    expect(checkEnv({ ...env, NODE_ENV: 'development' })).toEqual({ errors: [], warnings });
  });

  it('reports a missing secret and an example value together', () => {
    const { errors, warnings } = checkEnv({ JWT_SECRET: 'change-me', NODE_ENV: 'production' });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('APP_SECRET');
    expect(errors[1]).toContain('JWT_SECRET');
    expect(warnings).toEqual([]);
  });

  // Whoever knows JWT_SECRET signs a token for any user; a short one is guessed from one token of the app.
  describe('length of the secrets', () => {
    const tooShort = 'x'.repeat(MIN_SECRET_LENGTH - 1);
    const message = (names: string): string =>
      `Con menos de 32 caracteres en el archivo .env: ${names}. Usa una cadena larga y aleatoria, como la que da "openssl rand -hex 32".`;

    it('takes 32 characters as the least', () => {
      expect(MIN_SECRET_LENGTH).toBe(32);
      expect(VALID.JWT_SECRET).toHaveLength(32);
      expect(VALID.APP_SECRET).toHaveLength(32);
      // A hexadecimal string of 32 random bytes, as the README says to make one.
      expect(checkEnv({ ...VALID, NODE_ENV: 'production', JWT_SECRET: 'ab'.repeat(32), APP_SECRET: 'cd'.repeat(32) })).toEqual({ errors: [], warnings: [] });
    });

    it.each(['JWT_SECRET', 'APP_SECRET'])('refuses to start in production with a shorter %s', (name) => {
      expect(checkEnv({ ...VALID, NODE_ENV: 'production', [name]: tooShort })).toEqual({ errors: [message(name)], warnings: [] });
      // The spaces around it are not part of it.
      expect(checkEnv({ ...VALID, NODE_ENV: 'production', [name]: ` ${tooShort} ` }).errors).toEqual([message(name)]);
    });

    it('names both in one message, and only warns outside production', () => {
      const env = { ...VALID, JWT_SECRET: 'corta', APP_SECRET: tooShort };
      expect(checkEnv({ ...env, NODE_ENV: 'production' })).toEqual({ errors: [message('JWT_SECRET y APP_SECRET')], warnings: [] });
      expect(checkEnv(env)).toEqual({ errors: [], warnings: [`${message('JWT_SECRET y APP_SECRET')} En producción la API no inicia así.`] });
    });

    // The two have a message of their own already.
    it('says nothing of the length of a secret that is missing or still the example value', () => {
      expect(checkEnv({ ...VALID, NODE_ENV: 'production', JWT_SECRET: '', APP_SECRET: 'change-me' }).errors).toEqual([
        'Falta definir JWT_SECRET en el archivo .env. Usa una cadena larga y aleatoria.',
        'Con el valor de ejemplo "change-me" de .env.example: APP_SECRET. Cambia cada valor en el archivo .env.',
      ]);
    });
  });

  describe('lifetime of the sessions', () => {
    const message =
      'Corrige JWT_EXPIRES_IN en el archivo .env: debe ser un número entero seguido de s, m, h o d (segundos, minutos, horas o días), como 12h u 8h; sin definirla, vale 12h.';

    it('accepts it unset, empty, or as a number and its unit', () => {
      for (const JWT_EXPIRES_IN of [undefined, '', ' ', '12h', '30m', '7d', '3600s', ' 8h ']) {
        expect(checkEnv({ ...VALID, NODE_ENV: 'production', JWT_EXPIRES_IN })).toEqual({ errors: [], warnings: [] });
      }
    });

    // "3600" would be 3600 milliseconds to the library that signs the tokens: nobody could log in.
    it.each(['3600', '0h', '12 h', '12H', '1w', 'doce horas', '-1d', '1.5h'])('refuses to start, in any environment, with JWT_EXPIRES_IN=%s', (JWT_EXPIRES_IN) => {
      for (const NODE_ENV of ['production', undefined]) {
        expect(checkEnv({ ...VALID, NODE_ENV, JWT_EXPIRES_IN })).toEqual({ errors: [message], warnings: [] });
      }
    });
  });

  describe('limits per address', () => {
    it('accepts them unset, empty, or as whole numbers', () => {
      expect(checkEnv({ ...VALID, LOGIN_RATE_LIMIT: '', API_RATE_LIMIT: ' ', TRUST_PROXY_HOPS: undefined })).toEqual({ errors: [], warnings: [] });
      expect(checkEnv({ ...VALID, NODE_ENV: 'production', LOGIN_RATE_LIMIT: '20', API_RATE_LIMIT: '5000', TRUST_PROXY_HOPS: '0' })).toEqual({
        errors: [],
        warnings: [],
      });
    });

    // A typo must not start the API without a limit, or believing addresses a client writes.
    it.each([
      ['LOGIN_RATE_LIMIT', '0', 'Corrige LOGIN_RATE_LIMIT en el archivo .env: debe ser un número entero de 1 o más (sin definirla, vale 20).'],
      ['LOGIN_RATE_LIMIT', 'diez', 'Corrige LOGIN_RATE_LIMIT en el archivo .env: debe ser un número entero de 1 o más (sin definirla, vale 20).'],
      ['API_RATE_LIMIT', '1.5', 'Corrige API_RATE_LIMIT en el archivo .env: debe ser un número entero de 1 o más (sin definirla, vale 1000).'],
      ['TRUST_PROXY_HOPS', 'true', 'Corrige TRUST_PROXY_HOPS en el archivo .env: debe ser un número entero de 0 o más (sin definirla, vale 1).'],
    ])('refuses to start, in any environment, with %s=%s', (name, value, message) => {
      for (const NODE_ENV of ['production', undefined]) {
        expect(checkEnv({ ...VALID, NODE_ENV, [name]: value })).toEqual({ errors: [message], warnings: [] });
      }
    });
  });

  // The start-up makes the assistant an agent and the first user an administrator: one user would
  // change role on every start, and the assistant would be an administrator half of the time.
  describe('the assistant user and the first user', () => {
    const same = (username: string): string =>
      `MCP_USERNAME y ADMIN_USERNAME son el mismo usuario ("${username}") en el archivo .env. El del asistente es un agente y el ` +
      'inicial un administrador: usa un nombre distinto para cada uno.';

    it('refuses to start, in any environment, when they are the same user, however it is written', () => {
      for (const NODE_ENV of ['production', undefined]) {
        expect(checkEnv({ ...VALID, NODE_ENV, MCP_PASSWORD: 'otra', MCP_USERNAME: ' Soporte ', ADMIN_USERNAME: 'soporte' }).errors).toEqual([same('soporte')]);
      }
      // Each one left out is its default.
      expect(checkEnv({ ...VALID, MCP_PASSWORD: 'otra', MCP_USERNAME: 'admin' }).errors).toEqual([same('admin')]);
      expect(checkEnv({ ...VALID, MCP_PASSWORD: 'otra', ADMIN_USERNAME: 'Claude' }).errors).toEqual([same('claude')]);
    });

    it('accepts two different users, and any name without the assistant user', () => {
      expect(checkEnv({ ...VALID, MCP_PASSWORD: 'otra' }).errors).toEqual([]);
      expect(checkEnv({ ...VALID, MCP_PASSWORD: 'otra', MCP_USERNAME: 'asistente', ADMIN_USERNAME: 'jefa' }).errors).toEqual([]);
      // Without MCP_PASSWORD the API makes no assistant user.
      expect(checkEnv({ ...VALID, MCP_PASSWORD: '', MCP_USERNAME: 'admin' }).errors).toEqual([]);
    });
  });
});
