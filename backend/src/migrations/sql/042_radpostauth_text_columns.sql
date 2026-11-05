-- Migration: 042_radpostauth_text_columns
-- Description: Widen request-data varchar columns in radpostauth to text
-- Date: 2026-11-06
--
-- Background
-- ----------
-- RADIUS User-Name is up to 253 octets (RFC 2865 §5.1); FreeRADIUS's standard
-- post-auth INSERT writes %{User-Name} and %{User-Password} verbatim.  When an
-- operator's hotspot page sends a long username (e.g. a full sentence typed into
-- the login box), the INSERT fails with:
--   ERROR: value too long for type character varying(64)
-- This is harmless to auth (the Access-Accept/Reject has already been sent) but
-- produces daily SQL errors in the FreeRADIUS log.  calledstationid (MAC+SSID)
-- and callingstationid (client MAC) can also exceed 64 chars in some AP formats.
--
-- What we change
-- --------------
-- Columns widened to text (unbounded):
--   username         VARCHAR(64) → text   (RADIUS User-Name, up to 253 octets)
--   pass             VARCHAR(64) → text   (User-Password / CHAP-Password)
--   class            VARCHAR(64) → text   (Class attribute, operator-defined)
--   calledstationid  VARCHAR(64) → text   (AP MAC:SSID, commonly >64 chars)
--   callingstationid VARCHAR(64) → text   (client MAC, usually short but unbounded)
--
-- Column intentionally NOT changed:
--   reply  VARCHAR(32) — this is FreeRADIUS's own outcome string
--          ("Access-Accept", "Access-Reject", "Access-Challenge"), max ~20 chars;
--          not operator-supplied data, no truncation risk.
--
-- Why this is safe on a large live table
-- ----------------------------------------
-- varchar(n) → text is binary-coercible in PostgreSQL 16.  Postgres rewrites it
-- as a metadata-only operation (pg_attribute update) with no table or index
-- rewrite.  radpostauth_username_idx and radpostauth_class_idx are NOT rebuilt.
-- The only cost is the brief ACCESS EXCLUSIVE lock while pg_attribute is updated.
--
-- lock_timeout = 3s
-- -----------------
-- FreeRADIUS holds 32 pool connections; each post-auth waits for a pg lock before
-- it can INSERT.  If this ALTER cannot acquire ACCESS EXCLUSIVE within 3 seconds
-- (e.g. because a long-running read holds ACCESS SHARE), it raises
-- lock_not_available rather than queuing indefinitely.  The runner will ROLLBACK
-- and re-throw; the migration will be retried on the next backend boot.
-- That is the correct trade-off: a failed migration retry is far less harmful than
-- stalling all 32 FreeRADIUS connections behind a lock queue.
--
-- Runbook: never deploy during the nightly backup window 01:15–01:45 UTC.
-- pg_dump holds ACCESS SHARE on radpostauth even with --exclude-table-data=…,
-- which makes ACCESS EXCLUSIVE wait for the full dump duration, guaranteed to
-- exceed the 3 s timeout.

SET LOCAL lock_timeout = '3s';

ALTER TABLE radpostauth
  ALTER COLUMN username        TYPE text,
  ALTER COLUMN pass            TYPE text,
  ALTER COLUMN class           TYPE text,
  ALTER COLUMN calledstationid TYPE text,
  ALTER COLUMN callingstationid TYPE text;
