// The throwaway stack the end-to-end tests run against: db, api and web of this repository, built
// by Docker Compose under a project of their own, with their own volumes and their own port.
//
//   node scripts/stack.mjs up     builds and starts it, and waits until the API answers
//   node scripts/stack.mjs down   removes it: containers, volumes, network and the images it built
//   node scripts/stack.mjs logs   shows what its services wrote
//
// In Node and not in a shell script: it runs the same in PowerShell, Git Bash and Linux.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(e2eDir, '..');
/** Secrets and port of the stack. Git-ignored; written by `up`, removed by `down`. */
const envFile = join(e2eDir, '.stack.env');
const authDir = join(e2eDir, '.auth');

const DEFAULT_PROJECT = 'support-e2e';
const DEFAULT_PORT = 4321;
/** The real installation. Nothing here may ever touch it. */
const REAL_PROJECT = 'support-tickets';
const REAL_PORT = 4300;
/** Never `backup`: it writes into the backups folder of the real installation. */
const SERVICES = ['db', 'api', 'web'];
const READY_TIMEOUT_MS = Number(process.env.E2E_STACK_TIMEOUT_MS) || 180_000;

const project = process.env.E2E_PROJECT?.trim() || DEFAULT_PROJECT;

function fail(message) {
  console.error(`\n[stack] ${message}`);
  process.exit(1);
}

function readEnvFile() {
  if (!existsSync(envFile)) return null;
  const values = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function writeEnvFile(values) {
  const lines = [
    '# Written by e2e/scripts/stack.mjs for the throwaway stack of the end-to-end tests.',
    `# Docker Compose project: ${project}. Removed by "npm run stack:down". Not the .env of an installation.`,
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    '',
  ];
  writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
}

const secret = (bytes) => randomBytes(bytes).toString('hex');

function newEnv(port) {
  return {
    // Hexadecimal: the database password goes inside a connection URL.
    POSTGRES_PASSWORD: secret(24),
    JWT_SECRET: secret(32),
    APP_SECRET: secret(32),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: secret(16),
    ADMIN_NAME: 'Administrador E2E',
    // No assistant user: the tests do not go through the MCP server.
    MCP_PASSWORD: '',
    WEB_PORT: String(port),
    TZ: 'America/Guayaquil',
  };
}

function checkTarget(port) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) fail(`Nombre de proyecto no válido: "${project}".`);
  if (project === REAL_PROJECT) fail(`"${REAL_PROJECT}" es el proyecto de la instalación real. Las pruebas usan otro (por defecto "${DEFAULT_PROJECT}").`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Puerto no válido: "${port}".`);
  if (port === REAL_PORT) fail(`El puerto ${REAL_PORT} es el de la instalación real. Las pruebas usan otro (por defecto ${DEFAULT_PORT}).`);
}

/**
 * The variables of the shell would win over the env file in Compose: the ones the file sets,
 * and the ones that choose another project or other files, are left out of what Compose sees.
 */
function composeEnv(fileValues) {
  const env = { ...process.env };
  for (const key of [...Object.keys(fileValues), 'COMPOSE_PROJECT_NAME', 'COMPOSE_FILE', 'COMPOSE_PROFILES', 'BACKUP_DIR']) delete env[key];
  return env;
}

function compose(args, fileValues, options = {}) {
  const fullArgs = ['compose', '-p', project, '--env-file', envFile, '-f', join(repoDir, 'docker-compose.yml'), '-f', join(e2eDir, 'docker-compose.e2e.yml'), ...args];
  const result = spawnSync('docker', fullArgs, { cwd: repoDir, env: composeEnv(fileValues), stdio: options.capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.error) fail(`No se pudo ejecutar docker: ${result.error.message}`);
  return result;
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) fail(`No se pudo ejecutar docker: ${result.error.message}`);
  return result.stdout.trim();
}

async function waitForApi(port) {
  // A public route of the API, through nginx: it answers once the web, the API and its database are up.
  const url = `http://localhost:${port}/api/branding`;
  const started = Date.now();
  let last = '';
  while (Date.now() - started < READY_TIMEOUT_MS) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok && (response.headers.get('content-type') ?? '').includes('application/json')) {
        console.log(`[stack] Listo en http://localhost:${port} (${Math.round((Date.now() - started) / 1000)} s esperando al API).`);
        return true;
      }
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  console.error(`[stack] El API no respondió en ${READY_TIMEOUT_MS / 1000} s (último intento: ${last}).`);
  return false;
}

async function up() {
  const requested = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : undefined;
  let values = readEnvFile();
  const port = requested ?? (values?.WEB_PORT ? Number(values.WEB_PORT) : DEFAULT_PORT);
  checkTarget(port);

  if (!values) {
    // New secrets only for a new stack: the database volume keeps the password it was created with.
    values = newEnv(port);
    writeEnvFile(values);
    console.log(`[stack] Configuración nueva con secretos aleatorios en ${envFile}.`);
  } else if (values.WEB_PORT !== String(port)) {
    values = { ...values, WEB_PORT: String(port) };
    writeEnvFile(values);
  }

  console.log(`[stack] Construyendo y levantando ${SERVICES.join(', ')} del proyecto "${project}" en el puerto ${port}…`);
  const result = compose(['up', '-d', '--build', ...SERVICES], values);
  if (result.status !== 0) fail('docker compose up falló.');

  if (!(await waitForApi(port))) {
    compose(['logs', '--tail', '80', 'api', 'web'], values);
    fail('La pila de pruebas no quedó lista.');
  }
}

function leftovers() {
  const label = `label=com.docker.compose.project=${project}`;
  return {
    containers: docker(['ps', '-a', '--filter', label, '--format', '{{.Names}}']),
    volumes: docker(['volume', 'ls', '--filter', label, '--format', '{{.Name}}']),
    networks: docker(['network', 'ls', '--filter', label, '--format', '{{.Name}}']),
    images: [docker(['images', '--filter', label, '--format', '{{.Repository}}:{{.Tag}}']), docker(['images', '--filter', `reference=${project}-*`, '--format', '{{.Repository}}:{{.Tag}}'])]
      .filter(Boolean)
      .join('\n'),
  };
}

function down() {
  const port = Number(readEnvFile()?.WEB_PORT ?? DEFAULT_PORT);
  checkTarget(port);
  // Compose reads the file to know the services; without it (already removed), a stand-in with no secrets.
  const values = readEnvFile() ?? { WEB_PORT: String(port), POSTGRES_PASSWORD: 'x', JWT_SECRET: 'x', APP_SECRET: 'x', ADMIN_PASSWORD: 'x' };
  if (!existsSync(envFile)) writeEnvFile(values);

  console.log(`[stack] Eliminando el proyecto "${project}": contenedores, volúmenes, red e imágenes construidas…`);
  const result = compose(['down', '-v', '--rmi', 'local', '--remove-orphans'], values);
  if (result.status !== 0) fail('docker compose down falló.');
  rmSync(envFile, { force: true });
  rmSync(authDir, { recursive: true, force: true });

  const left = Object.entries(leftovers()).filter(([, names]) => names);
  if (left.length) fail(`Quedó algo del proyecto "${project}":\n${left.map(([kind, names]) => `  ${kind}: ${names.replace(/\n/g, ', ')}`).join('\n')}`);
  console.log(`[stack] No queda ningún contenedor, volumen, red ni imagen del proyecto "${project}".`);
}

function logs() {
  const values = readEnvFile();
  if (!values) fail('La pila de pruebas no está levantada (no existe .stack.env).');
  checkTarget(Number(values.WEB_PORT));
  compose(['logs', '--tail', '200', ...SERVICES], values);
}

const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'down') down();
else if (command === 'logs') logs();
else fail('Uso: node scripts/stack.mjs up|down|logs');
