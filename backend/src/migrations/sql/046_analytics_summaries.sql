-- 046_analytics_summaries.sql
-- Per-day summary tables built by scheduled jobs from the fact tables.
-- "day" = Africa/Khartoum calendar date.
-- analytics_usage_hourly is pruned to 40 days by the nightly rollup job.
-- UNIQUE NULLS NOT DISTINCT requires Postgres 15+; this project runs Postgres 16.

CREATE TABLE IF NOT EXISTS analytics_card_daily (
  day          DATE         NOT NULL,
  user_id      UUID         NOT NULL,
  router_id    UUID         NOT NULL,
  limit_type   VARCHAR(10),
  price        NUMERIC(10,2),
  cards_created INTEGER     NOT NULL DEFAULT 0,
  cards_used   INTEGER      NOT NULL DEFAULT 0,
  UNIQUE NULLS NOT DISTINCT (day, user_id, router_id, limit_type, price)
);
CREATE INDEX IF NOT EXISTS idx_acd_user_day ON analytics_card_daily (user_id, day);

CREATE TABLE IF NOT EXISTS analytics_usage_hourly (
  day       DATE      NOT NULL,
  hour      SMALLINT  NOT NULL,
  router_id UUID,
  user_id   UUID,
  sessions  INTEGER   NOT NULL,
  data_bytes BIGINT   NOT NULL,
  UNIQUE NULLS NOT DISTINCT (day, hour, router_id)
);

CREATE TABLE IF NOT EXISTS analytics_usage_daily (
  day        DATE     NOT NULL,
  router_id  UUID,
  user_id    UUID,
  sessions   INTEGER  NOT NULL,
  data_bytes BIGINT   NOT NULL,
  UNIQUE NULLS NOT DISTINCT (day, router_id)
);

CREATE TABLE IF NOT EXISTS analytics_hour_daily (
  day        DATE     NOT NULL,
  hour       SMALLINT NOT NULL,
  sessions   INTEGER  NOT NULL,
  data_bytes BIGINT   NOT NULL,
  PRIMARY KEY (day, hour)
);

CREATE TABLE IF NOT EXISTS analytics_uptime_daily (
  day                     DATE    NOT NULL,
  router_id               UUID    NOT NULL,
  user_id                 UUID    NOT NULL,
  observed_seconds        INTEGER NOT NULL,
  down_seconds            INTEGER NOT NULL,
  drops                   INTEGER NOT NULL,
  longest_outage_seconds  INTEGER NOT NULL,
  PRIMARY KEY (day, router_id)
);
