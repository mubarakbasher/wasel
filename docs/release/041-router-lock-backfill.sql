-- Hand backfill for 041_voucher_router_scope.sql on prod.
--
-- WHY NOT THE MIGRATION: 041 is one INSERT over about 2.5M vouchers. The runner
-- uses the shared pool (30 s statement_timeout), so at backend boot it would
-- roll back and crash-loop the backend. This file writes the same rows in
-- small commits. Afterwards, mark 041 applied in schema_migrations.
--
-- Run through psql in the Postgres container, outside a transaction:
--   docker exec -i <postgres> sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v mode=count -v only_routers=all -v stop_at=infinity -f -' < this-file
--
--   mode          count  = how many rows insert would add, changes nothing
--                 insert = add the missing lock rows (safe to re-run)
--                 delete = remove the lock rows (rollback)
--   only_routers  all, or comma-separated router ids, processed in that order
--   stop_at       timestamptz; stops cleanly at the next batch. It resumes
--                 safely on a later run. Use infinity for no limit.

\set ON_ERROR_STOP on
SET statement_timeout = 0;
SET application_name = 'wasel-041-backfill';
SELECT set_config('wasel.mode', :'mode', false),
       set_config('wasel.only_routers', :'only_routers', false),
       set_config('wasel.stop_at', :'stop_at', false);

DO $backfill$
DECLARE
  batch_size CONSTANT int := 5000;
  pause_seconds CONSTANT float8 := 0.05;
  run_mode CONSTANT text := current_setting('wasel.mode');
  only_raw CONSTANT text := current_setting('wasel.only_routers');
  stop_at CONSTANT timestamptz := current_setting('wasel.stop_at')::timestamptz;
  only_ids uuid[];
  r record;
  names varchar[];
  slice varchar[];
  i int;
  n bigint;
  router_rows bigint;
  total bigint := 0;
  batches bigint := 0;
  routers_done int := 0;
  stopped boolean := false;
  started CONSTANT timestamptz := clock_timestamp();
BEGIN
  IF run_mode NOT IN ('count', 'insert', 'delete') THEN
    RAISE EXCEPTION 'mode must be count, insert or delete, got %', run_mode;
  END IF;
  IF only_raw <> 'all' THEN
    only_ids := string_to_array(only_raw, ',')::uuid[];
  END IF;

  FOR r IN
    SELECT id, tunnel_ip
      FROM routers
     WHERE tunnel_ip IS NOT NULL
       AND (only_ids IS NULL OR id = ANY (only_ids))
     ORDER BY array_position(only_ids, id), id
  LOOP
    names := ARRAY(
      SELECT vm.radius_username
        FROM voucher_meta vm
       WHERE vm.router_id = r.id
       ORDER BY vm.radius_username
    );
    router_rows := 0;
    i := 1;

    WHILE i <= cardinality(names) LOOP
      IF clock_timestamp() >= stop_at THEN
        stopped := true;
        EXIT;
      END IF;

      slice := names[i : i + batch_size - 1];

      IF run_mode = 'count' THEN
        SELECT count(*) INTO n
          FROM unnest(slice) AS u(username)
         WHERE EXISTS (SELECT 1 FROM radcheck rc
                        WHERE rc.username = u.username
                          AND rc.attribute = 'Cleartext-Password')
           AND NOT EXISTS (SELECT 1 FROM radcheck rc
                            WHERE rc.username = u.username
                              AND rc.attribute = 'Packet-Src-IP-Address');
      ELSIF run_mode = 'insert' THEN
        INSERT INTO radcheck (username, attribute, op, value)
        SELECT u.username, 'Packet-Src-IP-Address', '==', r.tunnel_ip
          FROM unnest(slice) AS u(username)
         WHERE EXISTS (SELECT 1 FROM radcheck rc
                        WHERE rc.username = u.username
                          AND rc.attribute = 'Cleartext-Password')
           AND NOT EXISTS (SELECT 1 FROM radcheck rc
                            WHERE rc.username = u.username
                              AND rc.attribute = 'Packet-Src-IP-Address');
        GET DIAGNOSTICS n = ROW_COUNT;
      ELSE
        DELETE FROM radcheck rc
         USING unnest(slice) AS u(username)
         WHERE rc.username = u.username
           AND rc.attribute = 'Packet-Src-IP-Address'
           AND rc.op = '==';
        GET DIAGNOSTICS n = ROW_COUNT;
      END IF;

      COMMIT;
      router_rows := router_rows + n;
      total := total + n;
      batches := batches + 1;
      i := i + batch_size;
      IF run_mode <> 'count' AND n > 0 THEN
        PERFORM pg_sleep(pause_seconds);
      END IF;
    END LOOP;

    IF cardinality(names) > 0 THEN
      routers_done := routers_done + 1;
      IF router_rows > 0 THEN
        RAISE NOTICE 'router % cards % rows % total % seconds %',
          left(r.id::text, 8), cardinality(names), router_rows, total,
          round(extract(epoch FROM clock_timestamp() - started));
      END IF;
    END IF;
    EXIT WHEN stopped;
  END LOOP;

  RAISE NOTICE 'DONE mode=% rows=% batches=% routers=% stopped=% seconds=%',
    run_mode, total, batches, routers_done, stopped,
    round(extract(epoch FROM clock_timestamp() - started));
END
$backfill$;
