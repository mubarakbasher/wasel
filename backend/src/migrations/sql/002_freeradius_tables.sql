-- Migration: 002_freeradius_tables
-- Description: Standard FreeRADIUS 3.x schema for PostgreSQL (rlm_sql_postgresql)
-- Date: 2026-03-28

--
-- Table: radcheck
-- Per-user check attributes (e.g., Cleartext-Password, Expiration, Simultaneous-Use)
--
CREATE TABLE IF NOT EXISTS radcheck (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS radcheck_username_idx ON radcheck (username);

--
-- Table: radreply
-- Per-user reply attributes sent in Access-Accept
--
CREATE TABLE IF NOT EXISTS radreply (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS radreply_username_idx ON radreply (username);

--
-- Table: radgroupcheck
-- Group-level check attributes (e.g., Max-All-Session, Max-Total-Octets)
--
CREATE TABLE IF NOT EXISTS radgroupcheck (
    id SERIAL PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS radgroupcheck_groupname_idx ON radgroupcheck (groupname);

--
-- Table: radgroupreply
-- Group-level reply attributes (e.g., Mikrotik-Rate-Limit, Session-Timeout)
--
CREATE TABLE IF NOT EXISTS radgroupreply (
    id SERIAL PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT ':=',
    value VARCHAR(253) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS radgroupreply_groupname_idx ON radgroupreply (groupname);

--
-- Table: radusergroup
-- Maps usernames to group profiles with priority ordering
--
CREATE TABLE IF NOT EXISTS radusergroup (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS radusergroup_username_idx ON radusergroup (username);

--
-- Table: radacct
-- Accounting records from RADIUS Accounting-Request packets (Start/Interim/Stop)
--
CREATE TABLE IF NOT EXISTS radacct (
    radacctid BIGSERIAL PRIMARY KEY,
    acctsessionid VARCHAR(64) NOT NULL DEFAULT '',
    acctuniqueid VARCHAR(32) NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL DEFAULT '',
    realm VARCHAR(64) DEFAULT '',
    nasipaddress VARCHAR(15) NOT NULL DEFAULT '',
    nasportid VARCHAR(32) DEFAULT NULL,
    nasporttype VARCHAR(32) DEFAULT NULL,
    acctstarttime TIMESTAMPTZ DEFAULT NULL,
    acctupdatetime TIMESTAMPTZ DEFAULT NULL,
    acctstoptime TIMESTAMPTZ DEFAULT NULL,
    acctinterval INTEGER DEFAULT NULL,
    acctsessiontime INTEGER DEFAULT NULL,
    acctauthentic VARCHAR(32) DEFAULT NULL,
    connectinfo_start VARCHAR(128) DEFAULT NULL,
    connectinfo_stop VARCHAR(128) DEFAULT NULL,
    acctinputoctets BIGINT DEFAULT NULL,
    acctoutputoctets BIGINT DEFAULT NULL,
    calledstationid VARCHAR(64) NOT NULL DEFAULT '',
    callingstationid VARCHAR(64) NOT NULL DEFAULT '',
    acctterminatecause VARCHAR(32) NOT NULL DEFAULT '',
    servicetype VARCHAR(32) DEFAULT NULL,
    framedprotocol VARCHAR(32) DEFAULT NULL,
    framedipaddress VARCHAR(15) NOT NULL DEFAULT '',
    framedipv6address VARCHAR(45) NOT NULL DEFAULT '',
    framedipv6prefix VARCHAR(45) NOT NULL DEFAULT '',
    framedinterfaceid VARCHAR(44) NOT NULL DEFAULT '',
    delegatedipv6prefix VARCHAR(45) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS radacct_username_idx ON radacct (username);
CREATE INDEX IF NOT EXISTS radacct_acctsessionid_idx ON radacct (acctsessionid);
CREATE INDEX IF NOT EXISTS radacct_acctuniqueid_idx ON radacct (acctuniqueid);
CREATE INDEX IF NOT EXISTS radacct_acctstarttime_idx ON radacct (acctstarttime);
CREATE INDEX IF NOT EXISTS radacct_acctstoptime_idx ON radacct (acctstoptime);
CREATE INDEX IF NOT EXISTS radacct_nasipaddress_idx ON radacct (nasipaddress);
CREATE INDEX IF NOT EXISTS radacct_framedipaddress_idx ON radacct (framedipaddress);

--
-- Table: nas
-- Registered NAS (Network Access Server) clients — one entry per router
--
CREATE TABLE IF NOT EXISTS nas (
    id SERIAL PRIMARY KEY,
    nasname VARCHAR(128) NOT NULL,
    shortname VARCHAR(32),
    type VARCHAR(30) DEFAULT 'other',
    ports INTEGER DEFAULT NULL,
    secret VARCHAR(60) NOT NULL DEFAULT 'secret',
    server VARCHAR(64) DEFAULT NULL,
    community VARCHAR(50) DEFAULT NULL,
    description VARCHAR(200) DEFAULT 'RADIUS Client'
);

CREATE INDEX IF NOT EXISTS nas_nasname_idx ON nas (nasname);

--
-- Table: radpostauth
-- Post-authentication log for auditing auth attempts
--
CREATE TABLE IF NOT EXISTS radpostauth (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    pass VARCHAR(64) NOT NULL DEFAULT '',
    reply VARCHAR(32) NOT NULL DEFAULT '',
    authdate TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    class VARCHAR(64) DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS radpostauth_username_idx ON radpostauth (username);
CREATE INDEX IF NOT EXISTS radpostauth_class_idx ON radpostauth (class);
