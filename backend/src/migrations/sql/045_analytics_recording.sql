-- 045_analytics_recording.sql
-- State store (radacct cursor, monitor heartbeat), router uptime state/outages,
-- monitor gaps, and card fact tables (batches + first use).
-- No foreign keys — all history must survive operator/router deletes.

CREATE TABLE IF NOT EXISTS analytics_state (
  key        TEXT        PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO analytics_state (key) VALUES ('radacct_cursor'),('monitor_heartbeat') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS router_uptime_state (
  router_id    UUID        PRIMARY KEY,
  user_id      UUID        NOT NULL,
  tracked_since TIMESTAMPTZ NOT NULL,
  is_up        BOOLEAN     NOT NULL,
  changed_at   TIMESTAMPTZ NOT NULL,
  untracked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS router_outages (
  id         BIGSERIAL   PRIMARY KEY,
  router_id  UUID        NOT NULL,
  user_id    UUID        NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  end_reason VARCHAR(20)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_router_outages_open ON router_outages (router_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_router_outages_window ON router_outages (ended_at, started_at);

CREATE TABLE IF NOT EXISTS monitor_gaps (
  id         BIGSERIAL   PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_card_batches (
  id         BIGSERIAL    PRIMARY KEY,
  user_id    UUID         NOT NULL,
  router_id  UUID         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL,
  card_count INTEGER      NOT NULL,
  price      NUMERIC(10,2),
  limit_type VARCHAR(10),
  source     VARCHAR(10)  NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS idx_acb_created ON analytics_card_batches (created_at);
CREATE INDEX IF NOT EXISTS idx_acb_router ON analytics_card_batches (router_id, created_at);

CREATE TABLE IF NOT EXISTS analytics_card_first_use (
  radius_username  VARCHAR(64) PRIMARY KEY,
  user_id          UUID        NOT NULL,
  router_id        UUID        NOT NULL,
  price            NUMERIC(10,2),
  limit_type       VARCHAR(10),
  first_used_at    TIMESTAMPTZ NOT NULL,
  first_radacctid  BIGINT      NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acfu_used ON analytics_card_first_use (first_used_at);
