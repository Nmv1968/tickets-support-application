import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSIGNEE_NAME_MAX } from '../assignees/assignees.service';
import { MODULE_NAME_MAX } from '../catalog/modules.service';
import { COMPANY_NAME_MAX } from '../companies/companies.service';
import { SUPPORT_TYPE_NAME_MAX } from '../support-types/support-types.service';
import { byName, noteSearchKey, searchKey, supportTypesText, ticketSearchKey } from './labels';

/** Every character of the basic plane, one by one. The halves of a pair are not characters by themselves. */
function* characters(): Generator<string> {
  for (let code = 0; code <= 0xffff; code++) {
    if (code < 0xd800 || code > 0xdfff) yield String.fromCharCode(code);
  }
}

describe('searchKey', () => {
  // Two names with the same key are the same company, responsible or support type for the API.
  it('gives one key to the spellings of a name: any case, accents typed either way, any whitespace', () => {
    // "é" as one character, and as "e" followed by the accent, which is how text copied from a PDF arrives.
    expect(['Café Luna', 'Cafe\u0301 Luna', 'CAFÉ  LUNA', ' cafe\tluna '].map(searchKey)).toEqual(Array(4).fill('cafe luna'));
    // Letters Spanish does not have lose their accent too.
    expect(['São Paulo', 'SÃO PAULO', 'Škoda', 'Limões'].map(searchKey)).toEqual(['sao paulo', 'sao paulo', 'skoda', 'limoes']);
    // The space that does not break a line is a space.
    expect(searchKey('Café\u00a0Sol')).toBe('cafe sol');
  });

  it('removes accents, case and extra spaces', () => {
    expect(searchKey('  CORPORACIÓN   M&M ')).toBe('corporacion m&m');
    expect(searchKey('Ñandú')).toBe('nandu');
  });
});

describe('search keys', () => {
  it('joins company and description of a case without accents or case', () => {
    expect(ticketSearchKey('CORPORACIÓN Ñandú', 'No abre  la Facturación')).toBe('corporacion nandu no abre la facturacion');
  });

  it('strips accents and case from an observation', () => {
    expect(noteSearchKey('  Se REINICIÓ el servicio ')).toBe('se reinicio el servicio');
  });
});

describe('supportTypesText', () => {
  const named = (...names: string[]): { name: string }[] => names.map((name) => ({ name }));

  it('lists the types of a case by name, and is empty for a case without any', () => {
    expect(supportTypesText(named('Falla del sistema', 'capacitación', 'Ámbito'))).toBe('Ámbito, capacitación, Falla del sistema');
    expect(supportTypesText(named('Capacitación'))).toBe('Capacitación');
    expect(supportTypesText([])).toBe('');
  });

  // The answers of the API give the support types of a case in the order of this text (`byName`).
  it('says them in the order byName gives them, which leaves the list it is given as it was', () => {
    const types = [{ id: 2, name: 'Falla del sistema' }, { id: 1, name: 'capacitación' }];

    expect(byName(types).map((type) => type.id)).toEqual([1, 2]);
    expect(types.map((type) => type.id)).toEqual([2, 1]);
    expect(supportTypesText(types)).toBe(byName(types).map((type) => type.name).join(', '));
  });
});

// What the guards of the migrations below read in them.
/** The SQL of a migration, by the name of its folder. */
const migration = (name: string): string => readFileSync(join(__dirname, '../../prisma/migrations', name, 'migration.sql'), 'utf8');
/** The lists of characters of the patterns of a migration, written as PostgreSQL and JavaScript both read them, each once. */
const listsOf = (text: string): string[] => [...new Set(text.match(/\[(?:\\u[0-9a-f]{4}-?)+\]/g))];
/** SQL without its spaces: what a statement says, whatever its line breaks. */
const compact = (text: string): string => text.replace(/\s+/g, '');

// The migration that makes the companies a catalog groups the spellings of each one by a key
// written in SQL, and from then on the API tells two companies apart by `searchKey`. Where the two
// rules part, the migration leaves behind companies that the API takes for one and the same.
// What the SQL does was checked on a real PostgreSQL. This keeps its two lists of characters,
// which nothing else reads, equal to what `searchKey` does.
describe('the key the migration groups the companies by', () => {
  const sql = migration('20261113100000_companies_support_types_archive');
  const lists = listsOf(sql);
  const [marks, whitespace] = lists;

  it('is written with every character of its patterns as a code, in plain ASCII: none of them is seen in an editor', () => {
    expect(lists).toHaveLength(2);
    expect(sql).toMatch(/^\p{ASCII}*$/u);
  });

  it('takes the steps of searchKey in the same order: accents apart and dropped, lowercase, whitespace made one space, none around', () => {
    expect(compact(sql)).toContain(
      compact(`"companyKey" = btrim(regexp_replace(lower(regexp_replace(normalize("company", NFD), '${marks}', '', 'g')), '${whitespace}+', ' ', 'g'))`),
    );
    // No list of accented letters to keep up to date.
    expect(sql).not.toContain('translate(');
  });

  it('names each company as the catalog would store it: with its whitespace tidied by the same list', () => {
    expect(compact(sql)).toContain(compact(`SELECT DISTINCT ON ("companyKey") btrim(regexp_replace("company", '${whitespace}+', ' ', 'g')), "companyKey"`));
  });

  it('takes for whitespace the characters searchKey takes for it, and for accents the ones it drops', () => {
    const [isMark, isWhitespace] = [new RegExp(marks), new RegExp(whitespace)];
    const differences: string[] = [];
    for (const character of characters()) {
      const key = searchKey(`a${character}b`);
      if (isWhitespace.test(character) !== (key === 'a b') || isMark.test(character) !== (key === 'ab')) {
        differences.push(`U+${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
      }
    }

    expect(differences).toEqual([]);
  });
});

// The list of cases orders the companies by `Company.sortKey`, which the API writes as
// `searchKey(name)`. The migration that adds it fills it in SQL for the companies that exist, and a
// company it gave another key would stand out of its place in the list until it was renamed.
describe('the key the migration orders the companies by', () => {
  const sql = migration('20261114090000_company_sort_key');
  const [marks, whitespace] = listsOf(sql);

  // The lists of the migration that grouped the companies are checked above, character by character, against searchKey.
  it('is written in plain ASCII, with the two lists of characters of the key the companies were grouped by', () => {
    expect(sql).toMatch(/^\p{ASCII}*$/u);
    expect(listsOf(sql)).toEqual(listsOf(migration('20261113100000_companies_support_types_archive')));
  });

  it('is filled from the name with the steps of searchKey, in the same order', () => {
    expect(compact(sql)).toContain(
      compact(`UPDATE "Company" SET "sortKey" = btrim(regexp_replace(lower(regexp_replace(normalize("name", NFD), '${marks}', '', 'g')), '${whitespace}+', ' ', 'g'));`),
    );
    expect(sql).not.toContain('translate(');
  });

  it('leaves no company without it, and indexes it', () => {
    expect(compact(sql)).toContain(compact('ALTER TABLE "Company" ALTER COLUMN "sortKey" SET NOT NULL;'));
    expect(compact(sql)).toContain(compact('CREATE INDEX "Company_sortKey_idx" ON "Company"("sortKey");'));
  });
});

// The migration that makes the names unique fills the keys of the responsibles, the support types
// and the modules in SQL, and renames the names that already repeat a key. From then on the API
// writes `searchKey(name)` and the unique indexes compare what it writes with what the migration
// wrote: a key computed another way would let two names the API takes for one stay apart.
describe('the key the migration makes the names unique by', () => {
  const sql = migration('20261114120000_unique_catalog_names');
  const [marks, whitespace] = listsOf(sql);
  /** The block that renames the repeated names of a table. */
  const renaming = (table: string): string =>
    sql
      .split('DO $$')
      .map((block) => block.slice(0, block.indexOf('END $$;')))
      .find((block) => block.includes(`UPDATE "${table}" SET "name" = candidate`)) ?? '';
  const CATALOGS = [
    ['Company', 'sortKey', COMPANY_NAME_MAX],
    ['Assignee', 'nameKey', ASSIGNEE_NAME_MAX],
    ['SupportType', 'nameKey', SUPPORT_TYPE_NAME_MAX],
    ['SystemModule', 'nameKey', MODULE_NAME_MAX],
  ] as const;

  // The lists of the migration that grouped the companies are checked above, character by character, against searchKey.
  it('is written in plain ASCII, with the two lists of characters of the key the companies were grouped by', () => {
    expect(sql).toMatch(/^\p{ASCII}*$/u);
    expect(listsOf(sql)).toEqual(listsOf(migration('20261113100000_companies_support_types_archive')));
  });

  it('is one function, with the steps of searchKey in the same order', () => {
    expect(compact(sql)).toContain(
      compact(
        `CREATE FUNCTION pg_temp.search_key(name TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT btrim(regexp_replace(lower(regexp_replace(normalize(name, NFD), '${marks}', '', 'g')), '${whitespace}+', ' ', 'g')) $$;`,
      ),
    );
    expect(sql).not.toContain('translate(');
    // Written once: every other key of the migration is that function.
    expect(sql.match(/normalize\(/g)).toHaveLength(1);
  });

  it('fills the new key of every responsible, support type and module with it, and leaves none without one', () => {
    for (const table of ['Assignee', 'SupportType', 'SystemModule']) {
      const filled = compact(sql).indexOf(compact(`UPDATE "${table}" SET "nameKey" = pg_temp.search_key("name");`));
      expect(filled).toBeGreaterThan(-1);
      expect(compact(sql).indexOf(compact(`ALTER TABLE "${table}" ALTER COLUMN "nameKey" SET NOT NULL;`))).toBeGreaterThan(filled);
    }
  });

  // The longest name of each catalog is what its DTO takes: a renamed entry can still be edited
  // from the screen without shortening its name.
  it.each(CATALOGS)('renames each repeated name of %s to the first free "Name (2)"..., with the key of the new name and no longer than the API takes', (table, key, longest) => {
    const block = compact(renaming(table));

    expect(block).toContain(compact(`candidate := rtrim(left(repeated."name", ${longest} - length(' (' || copy_number || ')'))) || ' (' || copy_number || ')';`));
    expect(block).toContain(compact(`"${key}" = pg_temp.search_key(candidate)`));
    expect(block).toContain(compact(`UPDATE "${table}" SET "name" = candidate, "${key}" = pg_temp.search_key(candidate) WHERE "id" = repeated."id";`));
    // The active entry keeps its name, the oldest of the active ones when there are several.
    expect(block).toContain(compact('(NOT o."active", o."id") <'));
  });

  it.each(CATALOGS)('makes the key of %s unique once no name repeats it', (table, key) => {
    const index =
      table === 'SystemModule'
        ? `CREATE UNIQUE INDEX "SystemModule_parentId_nameKey_key" ON "SystemModule"("parentId", "nameKey") NULLS NOT DISTINCT;`
        : `CREATE UNIQUE INDEX "${table}_${key}_key" ON "${table}"("${key}");`;

    expect(compact(sql).indexOf(compact(index))).toBeGreaterThan(compact(sql).indexOf(compact(renaming(table))));
  });

  // Two submodules of different modules may be called the same; two main modules may not, and
  // PostgreSQL takes two null parents for different values unless told otherwise.
  it('compares the modules within their place, the main modules being one place too', () => {
    const block = compact(renaming('SystemModule'));

    expect(block).toContain(compact('o."parentId" IS NOT DISTINCT FROM m."parentId" AND o."nameKey" = m."nameKey"'));
    expect(block).toContain(compact('"parentId" IS NOT DISTINCT FROM repeated."parentId" AND "nameKey" = pg_temp.search_key(candidate)'));
  });

  // The search box finds a case by the name of its company too (`ticketSearchKey`).
  it('gives the cases of a renamed company the search key of its new name', () => {
    expect(compact(renaming('Company'))).toContain(
      compact(`UPDATE "Ticket" SET "searchText" = pg_temp.search_key(candidate || ' ' || "description") WHERE "companyId" = repeated."id";`),
    );
    expect(ticketSearchKey('Acme (2)', 'No imprime')).toBe(searchKey('Acme (2) No imprime'));
  });
});

describe('the migration that makes the stored files unique and the preferences JSON', () => {
  const sql = migration('20261114130000_attachment_and_preference_constraints');
  const at = (text: string): number => compact(sql).indexOf(compact(text));

  it('renames a stored name that an older attachment has before it makes them unique', () => {
    const renamed = at(`UPDATE "Attachment" a SET "storedName" = 'dup-' || a."id" || '-' || a."storedName"`);

    expect(renamed).toBeGreaterThan(-1);
    expect(at('CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");')).toBeGreaterThan(renamed);
  });

  // `jsonb` would order the keys of an object its own way, and refuse a string with a NUL in it.
  it('deletes a preference that is not JSON before it makes the column json, not jsonb', () => {
    const deleted = at(`DELETE FROM "UserPreference" WHERE NOT pg_input_is_valid("value", 'json');`);

    expect(deleted).toBeGreaterThan(-1);
    expect(at('ALTER TABLE "UserPreference" ALTER COLUMN "value" TYPE JSON USING "value"::json;')).toBeGreaterThan(deleted);
    // Only the comments name it.
    expect(sql.replace(/--.*$/gm, '')).not.toContain('jsonb');
  });
});
