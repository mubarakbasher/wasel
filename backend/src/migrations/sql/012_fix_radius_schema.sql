-- Migration: 012_fix_radius_schema
-- Description: Fix FreeRADIUS schema for compatibility with FreeRADIUS 3.2+
-- Date: 2026-04-10

-- 1. Create missing nasreload table (required by FreeRADIUS 3.2 accounting queries)
CREATE TABLE IF NOT EXISTS nasreload (
    nasipaddress VARCHAR(45) NOT NULL,
    reloadtime TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS nasreload_nasipaddress_idx ON nasreload (nasipaddress);

-- 2. Widen nasipaddress and framedipaddress columns to support longer values
--    VARCHAR(15) is too small — accounting INSERTs fail with STRING DATA RIGHT TRUNCATION
ALTER TABLE radacct ALTER COLUMN nasipaddress TYPE VARCHAR(45);
ALTER TABLE radacct ALTER COLUMN framedipaddress TYPE VARCHAR(45);

-- 3. Add missing columns to radpostauth (required by standard FreeRADIUS post-auth queries)
ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS calledstationid VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS callingstationid VARCHAR(64) NOT NULL DEFAULT '';

-- 4. Add missing class column to radacct (used by FreeRADIUS 3.2 accounting queries)
ALTER TABLE radacct ADD COLUMN IF NOT EXISTS class VARCHAR(64) DEFAULT NULL;

-- 5. Drop NOT NULL constraints on radacct columns that FreeRADIUS sends as NULL
--    (e.g. acctterminatecause is NULL during active sessions, IPv6 fields are NULL when unused)
ALTER TABLE radacct ALTER COLUMN acctterminatecause DROP NOT NULL;
ALTER TABLE radacct ALTER COLUMN framedipaddress DROP NOT NULL;
ALTER TABLE radacct ALTER COLUMN framedipv6address DROP NOT NULL;
ALTER TABLE radacct ALTER COLUMN framedipv6prefix DROP NOT NULL;
ALTER TABLE radacct ALTER COLUMN framedinterfaceid DROP NOT NULL;
ALTER TABLE radacct ALTER COLUMN delegatedipv6prefix DROP NOT NULL;
ALTER TABLE radacct ALTER COLUMN calledstationid DROP NOT NULL;
ALTER TABLE radacct ALTER COLUMN callingstationid DROP NOT NULL;
