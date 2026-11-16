-- The list of cases filters by module and by who registered the case, and the bell looks for the
-- cases past their SLA deadline and the forgotten ones, ordered by those two moments. Until now each
-- of those read the whole table. Only indexes: no row changes. Building them blocks the writes to
-- the cases for as long as it takes, a moment for the size of a support team's table.

-- CreateIndex
CREATE INDEX "Ticket_moduleId_idx" ON "Ticket"("moduleId");

-- CreateIndex
CREATE INDEX "Ticket_createdById_idx" ON "Ticket"("createdById");

-- CreateIndex
CREATE INDEX "Ticket_dueAt_idx" ON "Ticket"("dueAt");

-- CreateIndex
CREATE INDEX "Ticket_lastActivityAt_idx" ON "Ticket"("lastActivityAt");
