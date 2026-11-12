-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "promisedDate" DATE;

-- CreateIndex
CREATE INDEX "Ticket_promisedDate_idx" ON "Ticket"("promisedDate");
