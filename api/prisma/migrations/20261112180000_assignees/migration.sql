-- Responsibles get a catalog of their own: the people a case is assigned to need not be users.
CREATE TABLE "Assignee" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignee_pkey" PRIMARY KEY ("id")
);

-- Until now every user could be chosen as responsible. Each one becomes a responsible with the
-- same id, so the cases keep pointing at the right person without being rewritten.
INSERT INTO "Assignee" ("id", "name", "active", "createdAt")
SELECT "id", "name", "active", "createdAt" FROM "User";

-- The copied ids did not move the sequence: the next responsible must not reuse one of them.
SELECT setval(
    pg_get_serial_sequence('"Assignee"', 'id'),
    COALESCE((SELECT MAX("id") FROM "Assignee"), 1),
    EXISTS (SELECT 1 FROM "Assignee")
);

ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_assigneeId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "Assignee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each user who can log in stays linked to the responsible made from them.
ALTER TABLE "User" ADD COLUMN "assigneeId" INTEGER;
UPDATE "User" SET "assigneeId" = "id" WHERE "passwordHash" IS NOT NULL;
CREATE INDEX "User_assigneeId_idx" ON "User"("assigneeId");
ALTER TABLE "User" ADD CONSTRAINT "User_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "Assignee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The import used to create a user without a password for each new name in the sheet, only so
-- that the name could be a responsible. Those people now live in "Assignee" and were never able
-- to log in. Kept if anything else still points at them.
DELETE FROM "User" u
WHERE u."passwordHash" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."createdById" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "TicketNote" n WHERE n."authorId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "TicketHistory" h WHERE h."userId" = u."id");
