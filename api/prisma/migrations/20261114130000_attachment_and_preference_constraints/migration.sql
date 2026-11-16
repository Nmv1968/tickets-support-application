-- 1. One file per attachment. The API gives every stored file a name of its own, a new UUID
-- (`storedName`, api/src/tickets/attachment-files.ts), and now the database refuses a second row
-- with the same one: deleting either row deletes the file, and the other would be left without it.
-- No row should share a name. If some do, the oldest keeps it and each later one is renamed
-- "dup-<id>-<name>" (no stored name starts so) and no longer finds a file: to give it back, copy
-- the file under that new name in the folder of the attachments.
UPDATE "Attachment" a SET "storedName" = 'dup-' || a."id" || '-' || a."storedName"
WHERE EXISTS (SELECT 1 FROM "Attachment" o WHERE o."storedName" = a."storedName" AND o."id" < a."id");

CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");

-- 2. The value of a preference becomes JSON for the database too, and no longer a text the API
-- reads as JSON. The type is `json`, which keeps the text as the API wrote it: the keys of an
-- object in their order, and every string JSON can hold (`jsonb` orders the keys its own way and
-- refuses some strings). A row whose text is not JSON, which only a hand edit of the table could
-- leave, has always read as never saved; it is deleted, so it still reads that way.
DELETE FROM "UserPreference" WHERE NOT pg_input_is_valid("value", 'json');

ALTER TABLE "UserPreference" ALTER COLUMN "value" TYPE JSON USING "value"::json;
