// Starts server.mjs as an assistant would, over stdio, and calls its tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MCP_DIR = resolve(import.meta.dirname, '..');
/** A file that does not exist: the server must never read the .env of the installation. */
export const NO_ENV_FILE = join(tmpdir(), `soporte-mcp-pruebas-sin-env-${process.pid}`);

/**
 * `env` is all the configuration the server gets, on top of the few variables the SDK passes on
 * (PATH and the like). A value left undefined is not set.
 */
export async function startMcp(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(MCP_DIR, 'server.mjs')],
    cwd: MCP_DIR,
    env: Object.fromEntries(Object.entries({ ...getDefaultEnvironment(), SUPPORT_ENV_FILE: NO_ENV_FILE, ...env }).filter(([, value]) => value !== undefined)),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => (stderr += chunk));
  const client = new Client({ name: 'pruebas', version: '1.0.0' });
  await client.connect(transport);

  return {
    client,
    get stderr() {
      return stderr;
    },
    /** Calls a tool. `text` is what the assistant reads; `json()` parses it. */
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const text = result.content.map((part) => part.text).join('\n');
      return { isError: result.isError === true, text, json: () => JSON.parse(text) };
    },
    close: () => client.close(),
  };
}
