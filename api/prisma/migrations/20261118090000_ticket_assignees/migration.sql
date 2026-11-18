-- A case gets any number of responsibles, as it has support types: a table of its own takes the
-- place of the one column. Every case keeps the responsible it had, copied before the column goes;
-- the cases without one stay without any. Rows that already exist are kept: nothing else changes.

-- CreateTable
CREATE TABLE "TicketAssignee" (
    "ticketId" INTEGER NOT NULL,
    "assigneeId" INTEGER NOT NULL,

    CONSTRAINT "TicketAssignee_pkey" PRIMARY KEY ("ticketId","assigneeId")
);

-- CreateIndex
CREATE INDEX "TicketAssignee_assigneeId_idx" ON "TicketAssignee"("assigneeId");

-- AddForeignKey
ALTER TABLE "TicketAssignee" ADD CONSTRAINT "TicketAssignee_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey. Restrict, as for a support type: the API does not delete a responsible with cases.
ALTER TABLE "TicketAssignee" ADD CONSTRAINT "TicketAssignee_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "Assignee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The responsible of each case, active or not, before the column that held it is dropped.
INSERT INTO "TicketAssignee" ("ticketId", "assigneeId")
SELECT "id", "assigneeId" FROM "Ticket" WHERE "assigneeId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_assigneeId_fkey";

-- DropIndex
DROP INDEX "Ticket_assigneeId_idx";

-- AlterTable
ALTER TABLE "Ticket" DROP COLUMN "assigneeId";
