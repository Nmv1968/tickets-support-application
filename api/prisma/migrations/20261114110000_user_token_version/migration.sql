-- Every login token carries the number of its user, and the API refuses a token whose number is no
-- longer the stored one. The number goes up when the password, the role or the active state of the
-- user changes, so the sessions opened before end there. Every user that exists starts at 0. The
-- tokens signed before this migration carry no number at all and are refused as well: after this
-- update everybody logs in once more, and from then on a session lasts what JWT_EXPIRES_IN says.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
