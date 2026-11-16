import { hash } from 'bcryptjs';

// What a person logs in with, as the API keeps it: the username, written one way, and the
// password, as a bcrypt hash of one cost. The login, the users of Configuración and the seed all
// write them through here.

/** A username as it is stored and looked up: without the spaces around it, in lowercase. */
export function loginName(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * The usernames of the two users the start-up makes (`SeedService`), as stored: the assistant's
 * (`MCP_USERNAME`) and the first administrator's (`ADMIN_USERNAME`). `checkEnv` refuses a .env
 * where both are one user, so it has to read them exactly as the seed does.
 */
export function seededUsernames(env: NodeJS.ProcessEnv): { assistant: string; admin: string } {
  return { assistant: loginName(env.MCP_USERNAME ?? 'claude'), admin: loginName(env.ADMIN_USERNAME ?? 'admin') };
}

/**
 * The bcrypt cost of every password the API stores. The login compares with a hash of the same
 * cost when the username has none (`DUMMY_HASH`), so that no answer comes sooner than another.
 */
export const PASSWORD_COST = 10;

/** What a password is stored as. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_COST);
}
