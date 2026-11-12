/** Value every secret has in .env.example. */
const PLACEHOLDER = 'change-me';

/** Login tokens are signed with the first; the stored AI keys are encrypted with the second. */
const REQUIRED = ['JWT_SECRET', 'APP_SECRET'];

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

  return { errors, warnings };
}
