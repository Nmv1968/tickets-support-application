-- 1. Companies get a catalog of their own: until now each case carried the name as text.
CREATE TABLE "Company" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- Two working columns, dropped below. The key is the name as `searchKey` (api/src/common/labels.ts)
-- leaves it, in the same order of steps: that is how the API decides that two names are the same
-- company, so two spellings it would refuse as a repeated name must end up as one company here.
-- Accents are taken apart from their letter (NFD) and dropped, whatever the letter, then the text
-- goes to lowercase and every run of whitespace becomes one space, with none around.
-- The whitespace is listed by code point, the characters JavaScript's \s matches: what
-- PostgreSQL's own \s matches depends on the locale of the database.
ALTER TABLE "Company" ADD COLUMN "key" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "companyId" INTEGER, ADD COLUMN "companyKey" TEXT;

UPDATE "Ticket" SET "companyKey" = btrim(regexp_replace(
    lower(regexp_replace(normalize("company", NFD), '[\u0300-\u036f]', '', 'g')),
    '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'
));

-- One company per key, named as its oldest case spells it, with its whitespace tidied the same way.
INSERT INTO "Company" ("name", "key")
SELECT DISTINCT ON ("companyKey")
    btrim(regexp_replace("company", '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')),
    "companyKey"
FROM "Ticket"
ORDER BY "companyKey", "id";

UPDATE "Ticket" t SET "companyId" = c."id" FROM "Company" c WHERE c."key" = t."companyKey";

ALTER TABLE "Company" DROP COLUMN "key";
-- Dropping the text column drops its index with it.
ALTER TABLE "Ticket" DROP COLUMN "companyKey",
DROP COLUMN "company",
ALTER COLUMN "companyId" SET NOT NULL;

CREATE INDEX "Ticket_companyId_idx" ON "Ticket"("companyId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. "Cliente" stops being a switch of the case and becomes a responsible like any other. It is
-- added only when a case needs it and no responsible already has that name.
INSERT INTO "Assignee" ("name")
SELECT 'Cliente'
WHERE EXISTS (SELECT 1 FROM "Ticket" WHERE "assignedToClient")
  AND NOT EXISTS (SELECT 1 FROM "Assignee" WHERE lower(btrim("name")) = 'cliente');

UPDATE "Ticket"
SET "assigneeId" = (SELECT "id" FROM "Assignee" WHERE lower(btrim("name")) = 'cliente' ORDER BY "id" LIMIT 1)
WHERE "assignedToClient";

ALTER TABLE "Ticket" DROP COLUMN "assignedToClient";

-- 3. Users are no longer responsibles. The responsibles that exist only because a user was turned
-- into one go away; the ones with cases stay in the catalog, so those cases keep their person.
DELETE FROM "Assignee" a
WHERE EXISTS (SELECT 1 FROM "User" u WHERE u."assigneeId" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."assigneeId" = a."id");

ALTER TABLE "User" DROP CONSTRAINT "User_assigneeId_fkey";
DROP INDEX "User_assigneeId_idx";
ALTER TABLE "User" DROP COLUMN "assigneeId";

-- 4. Support types, archived cases and the preferences of each user.
CREATE TABLE "SupportType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TicketSupportType" (
    "ticketId" INTEGER NOT NULL,
    "supportTypeId" INTEGER NOT NULL,

    CONSTRAINT "TicketSupportType_pkey" PRIMARY KEY ("ticketId","supportTypeId")
);

CREATE INDEX "TicketSupportType_supportTypeId_idx" ON "TicketSupportType"("supportTypeId");
ALTER TABLE "TicketSupportType" ADD CONSTRAINT "TicketSupportType_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketSupportType" ADD CONSTRAINT "TicketSupportType_supportTypeId_fkey"
    FOREIGN KEY ("supportTypeId") REFERENCES "SupportType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Ticket" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Ticket_archivedAt_idx" ON "Ticket"("archivedAt");

CREATE TABLE "UserPreference" (
    "userId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId","key")
);

ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
