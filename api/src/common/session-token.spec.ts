import { JwtService } from '@nestjs/jwt';
import { DEFAULT_TOKEN_LIFETIME, END_SESSIONS, jwtOptions, sessionStands, tokenLifetimeSeconds, tokenPayload, verifiedPayload } from './session-token';

describe('lifetime of a login token', () => {
  it('is 12 hours unless JWT_EXPIRES_IN says otherwise', () => {
    expect(DEFAULT_TOKEN_LIFETIME).toBe('12h');
    for (const JWT_EXPIRES_IN of [undefined, '', '  ']) expect(tokenLifetimeSeconds({ JWT_EXPIRES_IN })).toBe(12 * 3600);
  });

  it('reads a whole number and its unit: seconds, minutes, hours or days', () => {
    expect(tokenLifetimeSeconds({ JWT_EXPIRES_IN: '90s' })).toBe(90);
    expect(tokenLifetimeSeconds({ JWT_EXPIRES_IN: '30m' })).toBe(1800);
    expect(tokenLifetimeSeconds({ JWT_EXPIRES_IN: ' 8h ' })).toBe(8 * 3600);
    expect(tokenLifetimeSeconds({ JWT_EXPIRES_IN: '7d' })).toBe(7 * 86_400);
  });

  // The library that signs the tokens reads the text "3600" as 3600 milliseconds.
  it('reads nothing else, a number without its unit least of all', () => {
    for (const JWT_EXPIRES_IN of ['3600', '0s', '12 h', '12H', '2w', '1.5h', '-1d', 'doce', `${'9'.repeat(20)}d`]) {
      expect(tokenLifetimeSeconds({ JWT_EXPIRES_IN })).toBeNull();
    }
  });

  it('is what JwtModule signs with, in seconds, with the secret of JWT_SECRET', () => {
    expect(jwtOptions({ JWT_SECRET: 'secreto', JWT_EXPIRES_IN: '8h' })).toEqual({ secret: 'secreto', signOptions: { expiresIn: 8 * 3600 } });
    expect(jwtOptions({ JWT_SECRET: 'secreto' })).toEqual({ secret: 'secreto', signOptions: { expiresIn: 12 * 3600 } });
    expect(() => jwtOptions({})).toThrow('JWT_SECRET is not set');
  });
});

describe('what a login token says', () => {
  it('is the user, their role and the version of their sessions', () => {
    expect(tokenPayload({ id: 5, role: 'AGENT', tokenVersion: 3 })).toEqual({ sub: 5, role: 'AGENT', ver: 3 });
  });

  // Written with the change: the version the tokens of before carry is not the stored one any more.
  it('stops matching once a change ends the sessions', () => {
    expect(END_SESSIONS).toEqual({ tokenVersion: { increment: 1 } });
  });
});

// Read by JwtGuard and by the limit per user of the API: what either one believes, the other does too.
describe('the token of an Authorization header', () => {
  const SECRET = 'secreto-de-las-pruebas-de-los-tokens-de-32-caracteres';
  const jwt = new JwtService({ secret: SECRET });
  const sign = (payload: object, secret = SECRET) => new JwtService({ secret }).signAsync(payload);

  it('says the user, the role and the version when this API signed it and it has not expired', async () => {
    const token = await sign({ sub: 5, role: 'AGENT', ver: 2 });

    expect(await verifiedPayload(jwt, `Bearer ${token}`)).toMatchObject({ sub: 5, role: 'AGENT', ver: 2 });
  });

  it.each([
    ['no header', () => Promise.resolve(undefined)],
    ['a token sent another way', async () => `Basic ${await sign({ sub: 5, role: 'AGENT', ver: 0 })}`],
    ['a token without its scheme', async () => sign({ sub: 5, role: 'AGENT', ver: 0 })],
    ['text that is not a token', () => Promise.resolve('Bearer basura')],
    ['a token signed with another secret', async () => `Bearer ${await sign({ sub: 5, role: 'AGENT', ver: 0 }, 'otro-secreto-de-otra-instalacion-de-32-caracteres')}`],
    ['an expired token', async () => `Bearer ${await sign({ sub: 5, role: 'AGENT', ver: 0, exp: Math.floor(Date.now() / 1000) - 10 })}`],
    ['a token without a user', async () => `Bearer ${await sign({ role: 'ADMIN', ver: 0 })}`],
    ['a token without a version, from before there were versions', async () => `Bearer ${await sign({ sub: 5, role: 'ADMIN' })}`],
    ['a token whose user is not a number', async () => `Bearer ${await sign({ sub: '5', role: 'ADMIN', ver: 0 })}`],
  ])('is nothing for %s', async (_case, header) => {
    expect(await verifiedPayload(jwt, await header())).toBeNull();
  });
});

// JwtGuard asks it of every request, and an open stream of events at each heartbeat.
describe('whether the session of a token stands', () => {
  const token = { sub: 5, role: 'AGENT' as const, ver: 2 };

  it('stands for the user it names, active and with the version of the token', () => {
    expect(sessionStands({ active: true, tokenVersion: 2 }, token)).toBe(true);
  });

  it('is over once the user is gone, inactive or has ended the sessions of that version', () => {
    expect(sessionStands(null, token)).toBe(false);
    expect(sessionStands({ active: false, tokenVersion: 2 }, token)).toBe(false);
    expect(sessionStands({ active: true, tokenVersion: 3 }, token)).toBe(false);
    expect(sessionStands({ active: true, tokenVersion: 1 }, token)).toBe(false);
  });
});
