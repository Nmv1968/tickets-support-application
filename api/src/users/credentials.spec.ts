import { compare, getRounds } from 'bcryptjs';
import { DUMMY_HASH } from '../auth/auth.service';
import { PASSWORD_COST, hashPassword, loginName, seededUsernames } from './credentials';

describe('what a person logs in with', () => {
  it('writes a username without the spaces around it and in lowercase, however it was typed', () => {
    expect(loginName('  Ana.Torres ')).toBe('ana.torres');
    expect(loginName('admin')).toBe('admin');
  });

  // The seed makes these users, and checkEnv refuses a .env where they are one: both read them here.
  it('gives the usernames of the assistant and of the first administrator as stored, with their defaults', () => {
    expect(seededUsernames({})).toEqual({ assistant: 'claude', admin: 'admin' });
    expect(seededUsernames({ MCP_USERNAME: ' Soporte.IA ', ADMIN_USERNAME: 'Jefa ' })).toEqual({ assistant: 'soporte.ia', admin: 'jefa' });
  });

  // The login compares with DUMMY_HASH when the username has no password: of the same cost, it takes as long.
  it('stores a password as a bcrypt hash of the cost of DUMMY_HASH', async () => {
    const stored = await hashPassword('secreto1');

    expect(PASSWORD_COST).toBe(10);
    expect(getRounds(stored)).toBe(PASSWORD_COST);
    expect(getRounds(DUMMY_HASH)).toBe(PASSWORD_COST);
    await expect(compare('secreto1', stored)).resolves.toBe(true);
    await expect(compare('secreto2', stored)).resolves.toBe(false);
  });
});
