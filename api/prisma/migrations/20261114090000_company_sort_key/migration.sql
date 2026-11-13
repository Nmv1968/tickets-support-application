-- The list of cases orders by company by this key and not by the name. The database compares text
-- by code point (it is created with the C.UTF-8 locale of the builtin provider): a name that starts
-- with an accented capital, or in lowercase, went after every name in capitals without accents,
-- "Zapateria" included. The key is the name as `searchKey` (api/src/common/labels.ts) leaves it,
-- written with the same expression as the key of 20261113100000_companies_support_types_archive,
-- which says why each step is there and why the whitespace is listed by code point. From here on
-- the API writes it with every name.
ALTER TABLE "Company" ADD COLUMN "sortKey" TEXT;

UPDATE "Company" SET "sortKey" = btrim(regexp_replace(
    lower(regexp_replace(normalize("name", NFD), '[\u0300-\u036f]', '', 'g')),
    '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'
));

ALTER TABLE "Company" ALTER COLUMN "sortKey" SET NOT NULL;

CREATE INDEX "Company_sortKey_idx" ON "Company"("sortKey");
