import { seededUsernames } from '../users/credentials';
import { DEFAULT_TOKEN_LIFETIME, tokenLifetimeSeconds } from './session-token';
import { THROTTLE_ENV, throttleEnvValue } from './throttle';
import type { ThrottleVariable } from './throttle';

/** Value every secret has in .env.example. */
const PLACEHOLDER = 'change-me';

/** Login tokens are signed with the first; the stored AI keys are encrypted with the second. */
const REQUIRED = ['JWT_SECRET', 'APP_SECRET'];

/**
 * Characters each of `REQUIRED` needs at least. Whoever knows JWT_SECRET signs a token for any
 * user, an administrator among them; a short one can be guessed from a single token of the app.
 */
export const MIN_SECRET_LENGTH = 32;

/**
 * Must not keep the value everyone can read in .env.example. The two passwords are here
 * because the API creates a user that can log in with each of them (see SeedService).
 */
const NO_PLACEHOLDER = [...REQUIRED, 'ADMIN_PASSWORD', 'MCP_PASSWORD'];

export interface EnvProblems {
  /** The API must not start with any of these. */
  errors: string[];
  warnings: string[];
}

/**
 * Looked at once, before the application is created, so a deployment with a missing or
 * copied-as-is secret stops with a message instead of failing at the first login or the
 * first AI key saved. In development the placeholder is tolerated: it only warns.
 */
export function checkEnv(env: NodeJS.ProcessEnv): EnvProblems {
  const errors: string[] = [];
  const warnings: string[] = [];

  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) {
    errors.push(`Falta definir ${missing.join(' y ')} en el archivo .env. Usa una cadena larga y aleatoria.`);
  }

  const placeholders = NO_PLACEHOLDER.filter((name) => env[name]?.trim() === PLACEHOLDER);
  if (placeholders.length) {
    const found = `Con el valor de ejemplo "${PLACEHOLDER}" de .env.example: ${placeholders.join(', ')}.`;
    if (env.NODE_ENV === 'production') errors.push(`${found} Cambia cada valor en el archivo .env.`);
    else warnings.push(`${found} En producción la API no inicia con ese valor.`);
  }

  // The missing ones and the example values have their own message above.
  const short = REQUIRED.filter((name) => {
    const value = env[name]?.trim();
    return !!value && value !== PLACEHOLDER && value.length < MIN_SECRET_LENGTH;
  });
  if (short.length) {
    const found = `Con menos de ${MIN_SECRET_LENGTH} caracteres en el archivo .env: ${short.join(' y ')}. Usa una cadena larga y aleatoria, como la que da "openssl rand -hex 32".`;
    if (env.NODE_ENV === 'production') errors.push(found);
    else warnings.push(`${found} En producción la API no inicia así.`);
  }

  // A typo must not leave the sessions without an end, or make them last a few milliseconds.
  if (tokenLifetimeSeconds(env) === null) {
    errors.push(
      `Corrige JWT_EXPIRES_IN en el archivo .env: debe ser un número entero seguido de s, m, h o d (segundos, minutos, horas o días), como 12h u 8h; sin definirla, vale ${DEFAULT_TOKEN_LIFETIME}.`,
    );
  }

  // The start-up makes the assistant user an agent and the first user an administrator (see
  // SeedService): one user cannot be both, and each start would undo the other half.
  if (env.MCP_PASSWORD) {
    const { assistant, admin } = seededUsernames(env);
    if (assistant === admin) {
      errors.push(
        `MCP_USERNAME y ADMIN_USERNAME son el mismo usuario ("${assistant}") en el archivo .env. El del asistente es un agente y el ` +
          'inicial un administrador: usa un nombre distinto para cada uno.',
      );
    }
  }

  // A typo here must not leave the API without its limits, or with the wrong address for each client.
  for (const name of Object.keys(THROTTLE_ENV) as ThrottleVariable[]) {
    if (throttleEnvValue(env, name) === null) {
      const { fallback, min } = THROTTLE_ENV[name];
      errors.push(`Corrige ${name} en el archivo .env: debe ser un número entero de ${min} o más (sin definirla, vale ${fallback}).`);
    }
  }

  return { errors, warnings };
}
