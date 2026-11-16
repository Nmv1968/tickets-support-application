-- Names that differ only in case, accents or spaces are one and the same name for the API
-- (`searchKey`, api/src/common/labels.ts): two companies, two responsibles, two support types, or
-- two modules in the same place, cannot have them. Until now the API made sure by comparing a new
-- name with the whole catalog behind an advisory lock, and a rename went without the lock. From
-- here on a unique index on the key of the name refuses the second one, whoever writes it.
--
-- The key is the name as `searchKey` leaves it, written with the same expression as the keys of
-- 20261113100000_companies_support_types_archive and 20261114090000_company_sort_key, which say
-- why each step is there and why the whitespace is listed by code point. Here it is a function of
-- this session only (pg_temp), so that the expression is written once.
CREATE FUNCTION pg_temp.search_key(name TEXT) RETURNS TEXT LANGUAGE sql AS $$
    SELECT btrim(regexp_replace(
        lower(regexp_replace(normalize(name, NFD), '[\u0300-\u036f]', '', 'g')),
        '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'
    ))
$$;

-- A database may already hold two names with the same key: two requests that arrived together
-- before the lock existed, or a rename, which never took it. The unique index would fail on them.
-- Of the entries that share a key, the active one keeps its name (the oldest, when several are
-- active); each of the others is renamed "Name (2)", "Name (3)"..., the first such name whose key
-- is free, shortened if needed to the longest name the API takes (200 characters for a company, 80
-- for a responsible or a module, 60 for a support type), and gets the key of that name. Nothing
-- else changes: their cases keep pointing at them, and a person can merge or rename them later.

-- 1. Companies. Their key is `sortKey` (20261114090000_company_sort_key): the list of cases already
-- orders by it, and now it is unique too. The index that ordered by it gives way to the unique one.
DROP INDEX "Company_sortKey_idx";

DO $$
DECLARE
    repeated RECORD;
    copy_number INTEGER;
    candidate TEXT;
BEGIN
    FOR repeated IN
        SELECT c."id", c."name" FROM "Company" c
        WHERE EXISTS (
            SELECT 1 FROM "Company" o
            WHERE o."sortKey" = c."sortKey" AND (NOT o."active", o."id") < (NOT c."active", c."id")
        )
        ORDER BY NOT c."active", c."id"
    LOOP
        copy_number := 2;
        LOOP
            candidate := rtrim(left(repeated."name", 200 - length(' (' || copy_number || ')'))) || ' (' || copy_number || ')';
            EXIT WHEN NOT EXISTS (SELECT 1 FROM "Company" WHERE "sortKey" = pg_temp.search_key(candidate));
            copy_number := copy_number + 1;
        END LOOP;
        UPDATE "Company" SET "name" = candidate, "sortKey" = pg_temp.search_key(candidate) WHERE "id" = repeated."id";
        -- The search box finds a case by the name of its company too (`ticketSearchKey`), as after
        -- any rename.
        UPDATE "Ticket" SET "searchText" = pg_temp.search_key(candidate || ' ' || "description") WHERE "companyId" = repeated."id";
    END LOOP;
END $$;

CREATE UNIQUE INDEX "Company_sortKey_key" ON "Company"("sortKey");

-- 2. Responsibles.
ALTER TABLE "Assignee" ADD COLUMN "nameKey" TEXT;

UPDATE "Assignee" SET "nameKey" = pg_temp.search_key("name");

DO $$
DECLARE
    repeated RECORD;
    copy_number INTEGER;
    candidate TEXT;
BEGIN
    FOR repeated IN
        SELECT a."id", a."name" FROM "Assignee" a
        WHERE EXISTS (
            SELECT 1 FROM "Assignee" o
            WHERE o."nameKey" = a."nameKey" AND (NOT o."active", o."id") < (NOT a."active", a."id")
        )
        ORDER BY NOT a."active", a."id"
    LOOP
        copy_number := 2;
        LOOP
            candidate := rtrim(left(repeated."name", 80 - length(' (' || copy_number || ')'))) || ' (' || copy_number || ')';
            EXIT WHEN NOT EXISTS (SELECT 1 FROM "Assignee" WHERE "nameKey" = pg_temp.search_key(candidate));
            copy_number := copy_number + 1;
        END LOOP;
        UPDATE "Assignee" SET "name" = candidate, "nameKey" = pg_temp.search_key(candidate) WHERE "id" = repeated."id";
    END LOOP;
END $$;

ALTER TABLE "Assignee" ALTER COLUMN "nameKey" SET NOT NULL;

CREATE UNIQUE INDEX "Assignee_nameKey_key" ON "Assignee"("nameKey");

-- 3. Support types.
ALTER TABLE "SupportType" ADD COLUMN "nameKey" TEXT;

UPDATE "SupportType" SET "nameKey" = pg_temp.search_key("name");

DO $$
DECLARE
    repeated RECORD;
    copy_number INTEGER;
    candidate TEXT;
BEGIN
    FOR repeated IN
        SELECT s."id", s."name" FROM "SupportType" s
        WHERE EXISTS (
            SELECT 1 FROM "SupportType" o
            WHERE o."nameKey" = s."nameKey" AND (NOT o."active", o."id") < (NOT s."active", s."id")
        )
        ORDER BY NOT s."active", s."id"
    LOOP
        copy_number := 2;
        LOOP
            candidate := rtrim(left(repeated."name", 60 - length(' (' || copy_number || ')'))) || ' (' || copy_number || ')';
            EXIT WHEN NOT EXISTS (SELECT 1 FROM "SupportType" WHERE "nameKey" = pg_temp.search_key(candidate));
            copy_number := copy_number + 1;
        END LOOP;
        UPDATE "SupportType" SET "name" = candidate, "nameKey" = pg_temp.search_key(candidate) WHERE "id" = repeated."id";
    END LOOP;
END $$;

ALTER TABLE "SupportType" ALTER COLUMN "nameKey" SET NOT NULL;

CREATE UNIQUE INDEX "SupportType_nameKey_key" ON "SupportType"("nameKey");

-- 4. Modules: unique within their place, the submodules of one module or the main modules. Two
-- submodules of different modules may share a name ("Ventas > Facturas", "Compras > Facturas").
ALTER TABLE "SystemModule" ADD COLUMN "nameKey" TEXT;

UPDATE "SystemModule" SET "nameKey" = pg_temp.search_key("name");

DO $$
DECLARE
    repeated RECORD;
    copy_number INTEGER;
    candidate TEXT;
BEGIN
    FOR repeated IN
        SELECT m."id", m."name", m."parentId" FROM "SystemModule" m
        WHERE EXISTS (
            SELECT 1 FROM "SystemModule" o
            WHERE o."parentId" IS NOT DISTINCT FROM m."parentId" AND o."nameKey" = m."nameKey"
              AND (NOT o."active", o."id") < (NOT m."active", m."id")
        )
        ORDER BY NOT m."active", m."id"
    LOOP
        copy_number := 2;
        LOOP
            candidate := rtrim(left(repeated."name", 80 - length(' (' || copy_number || ')'))) || ' (' || copy_number || ')';
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM "SystemModule"
                WHERE "parentId" IS NOT DISTINCT FROM repeated."parentId" AND "nameKey" = pg_temp.search_key(candidate)
            );
            copy_number := copy_number + 1;
        END LOOP;
        UPDATE "SystemModule" SET "name" = candidate, "nameKey" = pg_temp.search_key(candidate) WHERE "id" = repeated."id";
    END LOOP;
END $$;

ALTER TABLE "SystemModule" ALTER COLUMN "nameKey" SET NOT NULL;

-- NULLS NOT DISTINCT: by default PostgreSQL takes two null parents for different values, and the
-- main modules (no parent) could repeat a name. Prisma cannot say this in schema.prisma, nor does
-- it compare it: an index made again from schema.prisma would be made without it.
CREATE UNIQUE INDEX "SystemModule_parentId_nameKey_key" ON "SystemModule"("parentId", "nameKey") NULLS NOT DISTINCT;
