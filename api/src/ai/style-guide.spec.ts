import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readStyleGuide } from './ai.service';

// The project ships a general writing guide. A team that has its own puts it in a file beside it,
// which is not under version control: the project's guide can then be updated without touching theirs.
describe('readStyleGuide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guia-de-estilo-'));
  const own = join(dir, 'estilo-respuestas.local.md');
  const general = join(dir, 'estilo-respuestas.md');
  const order = [own, general];

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('gives nothing when there is no guide at all', async () => {
    expect(await readStyleGuide(order)).toBe('');
  });

  it('uses the general guide when the team has none of its own', async () => {
    writeFileSync(general, 'Guía general');

    expect(await readStyleGuide(order)).toBe('Guía general');
  });

  it("uses the team's own guide when it exists", async () => {
    writeFileSync(own, 'Guía del equipo');

    expect(await readStyleGuide(order)).toBe('Guía del equipo');
  });

  it('goes back to the general guide when the own one is empty', async () => {
    writeFileSync(own, '  \n');

    expect(await readStyleGuide(order)).toBe('Guía general');
  });

  it('finds the guide the project ships', async () => {
    const shipped = await readStyleGuide([resolve(process.cwd(), 'assets', 'estilo-respuestas.md')]);

    expect(shipped).toContain('# Guía de estilo para mensajes a clientes');
  });
});
