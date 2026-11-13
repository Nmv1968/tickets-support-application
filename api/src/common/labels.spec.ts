import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchKey } from './labels';

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
});

// The migration that makes the companies a catalog groups the spellings of each one by a key
// written in SQL, and from then on the API tells two companies apart by `searchKey`. Where the two
// rules part, the migration leaves behind companies that the API takes for one and the same.
// What the SQL does was checked on a real PostgreSQL. This keeps its two lists of characters,
// which nothing else reads, equal to what `searchKey` does.
describe('the key the migration groups the companies by', () => {
  const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261113100000_companies_support_types_archive/migration.sql'), 'utf8');
  /** The lists of characters of the patterns of the migration, written as PostgreSQL and JavaScript both read them. */
  const lists = [...new Set(sql.match(/\[(?:\\u[0-9a-f]{4}-?)+\]/g))];
  const [marks, whitespace] = lists;
  const compact = (text: string): string => text.replace(/\s+/g, '');

  it('is written with every character of its patterns as a code, in plain ASCII: none of them is seen in an editor', () => {
    expect(lists).toHaveLength(2);
    expect(sql).toMatch(/^[\x00-\x7f]*$/);
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
  const migration = (name: string): string => readFileSync(join(__dirname, '../../prisma/migrations', name, 'migration.sql'), 'utf8');
  const sql = migration('20261114090000_company_sort_key');
  const listsOf = (text: string): string[] => [...new Set(text.match(/\[(?:\\u[0-9a-f]{4}-?)+\]/g))];
  const [marks, whitespace] = listsOf(sql);
  const compact = (text: string): string => text.replace(/\s+/g, '');

  // The lists of the migration that grouped the companies are checked above, character by character, against searchKey.
  it('is written in plain ASCII, with the two lists of characters of the key the companies were grouped by', () => {
    expect(sql).toMatch(/^[\x00-\x7f]*$/);
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
