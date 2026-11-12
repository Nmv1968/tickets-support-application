// Local PostgreSQL for development on machines without Docker.
// Docker Compose does not use this: it runs the real `db` service.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseDir = resolve(import.meta.dirname, '.pgdata');
const firstRun = !existsSync(resolve(databaseDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'support',
  password: 'support',
  port: 5433,
  persistent: true,
  // Without an explicit encoding, initdb on Windows picks the system code page (WIN1252).
  // The builtin C.UTF-8 locale behaves the same on every platform (same flags as docker-compose.yml).
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'],
  onLog: () => {},
});

if (firstRun) await pg.initialise();
await pg.start();
if (firstRun) await pg.createDatabase('support');

console.log('PostgreSQL de desarrollo listo en localhost:5433 (base "support"). Ctrl+C para detener.');

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
