-- Until now every user could do everything: each one that exists becomes an administrator, so
-- nobody loses what they could do. From here on a new user is an agent unless an administrator
-- makes them one. The assistant user of the MCP server is set back to agent by the API on every
-- start (SeedService).
CREATE TYPE "Role" AS ENUM ('ADMIN', 'AGENT');

ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'ADMIN';

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'AGENT';
