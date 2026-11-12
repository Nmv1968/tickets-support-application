-- AlterTable
-- The default fills the rows that already exist; the UPDATE below gives them their real value.
ALTER TABLE "Ticket" ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "searchText" DROP DEFAULT;

-- Until now last activity was read from "updatedAt": existing cases keep the value they had.
UPDATE "Ticket" SET "lastActivityAt" = "updatedAt";

-- AlterTable
ALTER TABLE "TicketNote" ALTER COLUMN "searchText" DROP DEFAULT;
