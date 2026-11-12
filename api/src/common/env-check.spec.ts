import { checkEnv } from './env-check';

const VALID = { JWT_SECRET: 'a-long-random-string', APP_SECRET: 'another-long-random-string', ADMIN_PASSWORD: 'not-the-example' };

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
});
