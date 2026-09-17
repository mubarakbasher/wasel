#!/bin/sh
# wasel-healthcheck: FreeRADIUS Status-Server probe with a SIGKILL watchdog.
#
# Why this exists (incident 2026-09-15):
#   The previous healthcheck was `pgrep freeradius`, which kept returning
#   healthy while the main thread was stuck in an infinite libtalloc loop.
#   FreeRADIUS was also PID 1 in its container, so nothing inside the container
#   could SIGKILL it.  With `init: true` added to the compose service,
#   docker-init is now PID 1 and freeradius is a child; this script can send
#   SIGKILL, and `restart: unless-stopped` brings a fresh container back.
#
# Probe design:
#   Status-Server needs no SQL: the main thread decodes it and queues it at
#   the highest priority to a worker thread.  It still goes unanswered when
#   the main thread is hung, when every worker is blocked in SQL, or while the
#   main thread runs a dynamic-client lookup (synchronous SQL on the first
#   packet from an uncached router IP) against a stalled DB.
#
# Two kill thresholds:
#   - Main thread SPINNING on CPU (the 2026-09-15 signature: state R, ~92 %
#     CPU, zero syscalls) -> SIGKILL after FR_WATCHDOG_KILL_AFTER counted
#     failures (default 8, ~3 min).  A spin never recovers on its own.
#   - Main thread NOT spinning (blocked on SQL/poll/futex, or stopped) ->
#     SIGKILL only after FR_WATCHDOG_KILL_AFTER_STALLED counted failures
#     (default 30, ~10 min).  A DB stall usually clears by itself, and a
#     restart into a stalled DB re-runs ~2 lookups per router on the main
#     thread and would loop.  The long ceiling still recovers a deadlock.
#   "Spinning" = main-thread utime+stime grew by >= 50 % of wall time since
#   the first counted failure of the episode.
#
# Counter file strategy:
#   Counter is keyed by PID + process start-ticks so it auto-resets after a
#   restart (PIDs reuse; start-ticks do not).
#
# Operator hold (docs/OBSERVABILITY.md §2.7 step 0):
#   While /tmp/wasel-fr-watchdog-hold exists and is younger than
#   FR_WATCHDOG_HOLD_MAX_MIN minutes, a failed probe is neither counted nor
#   acted on, so a live hang can be profiled before the watchdog kills it.
#   The name deliberately does not match the counter glob
#   `wasel-fr-watchdog.*`, so a passing probe does not clear it;
#   docker-entrypoint.sh removes it on container start.
#
# NOT read-only:
#   Running this script by hand shares the failure counter with Docker's
#   HEALTHCHECK and can itself send the SIGKILL.  To check health, read
#   `docker inspect .State.Health` or send a bare radclient Status-Server.

FR_WATCHDOG_GRACE_S=${FR_WATCHDOG_GRACE_S:-90}
FR_WATCHDOG_KILL_AFTER=${FR_WATCHDOG_KILL_AFTER:-8}
FR_WATCHDOG_KILL_AFTER_STALLED=${FR_WATCHDOG_KILL_AFTER_STALLED:-30}
FR_WATCHDOG_HOLD_MAX_MIN=${FR_WATCHDOG_HOLD_MAX_MIN:-30}
HOLD_FILE=/tmp/wasel-fr-watchdog-hold

# ---------------------------------------------------------------------------
# 1. Find the freeradius PID by scanning /proc/[0-9]*/comm
# ---------------------------------------------------------------------------
FR_PID=""
for _comm_file in /proc/[0-9]*/comm; do
    _comm=$(cat "$_comm_file" 2>/dev/null) || continue
    if [ "$_comm" = "freeradius" ]; then
        _dir="${_comm_file%/comm}"
        FR_PID="${_dir#/proc/}"
        break
    fi
done

if [ -z "$FR_PID" ]; then
    echo "freeradius-watchdog: no freeradius process found in /proc"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Read process start time from /proc/PID/stat (field 22 = starttime).
#
#    /proc/PID/stat format: pid (comm) state ppid pgrp session tty_nr tpgid
#    flags minflt cminflt majflt cmajflt utime(14) stime(15) ... starttime(22)
#
#    comm may contain spaces and parentheses.  Strip everything up to and
#    including the last ") " so that the remaining whitespace-separated fields
#    start at stat field 3 (state = remaining field 1).  starttime (stat field
#    22) is then remaining field 20.
# ---------------------------------------------------------------------------
STAT_LINE=$(cat "/proc/$FR_PID/stat" 2>/dev/null) || {
    echo "freeradius-watchdog: cannot read /proc/$FR_PID/stat"
    exit 1
}
STAT_AFTER_COMM="${STAT_LINE##*) }"
STARTTIME=$(echo "$STAT_AFTER_COMM" | awk '{print $20}')

COUNTER_FILE="/tmp/wasel-fr-watchdog.${FR_PID}.${STARTTIME}"

# ---------------------------------------------------------------------------
# 3. Probe: send a Status-Server packet with the loopback client secret.
#
#    testing123 is the secret for the localhost client in clients.conf.
#    Status-Server does not go through rlm_sql.  A healthy server replies
#    "Received Access-Accept".
#    Cap total wait at 6 s (-t 3 per attempt, -r 1 retry = one 3-s attempt +
#    one 3-s timeout in the wrapper).
# ---------------------------------------------------------------------------
PROBE_OUT=$(printf 'Message-Authenticator = 0x00\n' \
    | timeout 6 radclient -x -t 3 -r 1 127.0.0.1:1812 status testing123 2>&1) || true

if echo "$PROBE_OUT" | grep -q "Received Access-"; then
    # Healthy — clear any accumulated failure counts from a previous stall.
    rm -f /tmp/wasel-fr-watchdog.*
    echo "freeradius-watchdog: ok"
    exit 0
fi

# ---------------------------------------------------------------------------
# 3b. Probe failed — honour an operator hold before counting.  Still exit 1 so
#     Docker keeps reporting the real (unhealthy) state.
# ---------------------------------------------------------------------------
if [ -f "$HOLD_FILE" ] \
    && [ -n "$(find "$HOLD_FILE" -mmin "-${FR_WATCHDOG_HOLD_MAX_MIN}" 2>/dev/null)" ]; then
    echo "freeradius-watchdog: no Status-Server reply; operator hold $HOLD_FILE present, not counting or killing"
    exit 1
fi

# ---------------------------------------------------------------------------
# 4. Probe failed — check startup grace period before counting.
#
#    Process age = boot_uptime_s - starttime_ticks / CLK_TCK.
#    If the process is younger than FR_WATCHDOG_GRACE_S, it may still be
#    loading modules; do not count or kill.
# ---------------------------------------------------------------------------
CLK_TCK=$(getconf CLK_TCK 2>/dev/null) || CLK_TCK=100
UPTIME_INT=$(awk '{printf "%d", $1}' /proc/uptime)
AGE_S=$(( UPTIME_INT - STARTTIME / CLK_TCK ))

if [ "$AGE_S" -lt "$FR_WATCHDOG_GRACE_S" ]; then
    echo "freeradius-watchdog: in startup grace (age=${AGE_S}s < ${FR_WATCHDOG_GRACE_S}s), not counting"
    exit 1
fi

# ---------------------------------------------------------------------------
# 5. Increment the failure counter and classify the main thread.
#
#    Counter file holds "COUNT FIRST_UPTIME_S FIRST_MAIN_CPU_TICKS"; the last
#    two are captured at the first counted failure of this episode.  The main
#    thread is the task whose tid equals the PID; its utime/stime are
#    remaining fields 12/13 of /proc/PID/task/PID/stat.
# ---------------------------------------------------------------------------
MAIN_STAT=$(cat "/proc/$FR_PID/task/$FR_PID/stat" 2>/dev/null) || MAIN_STAT=""
# Intentionally unquoted: split the post-comm fields into $1..$N.
set -- ${MAIN_STAT##*) }
MAIN_STATE=${1:-?}
MAIN_CPU=$(( ${12:-0} + ${13:-0} ))

COUNT=0
FIRST_UPTIME=$UPTIME_INT
FIRST_CPU=$MAIN_CPU
if [ -f "$COUNTER_FILE" ]; then
    read -r COUNT FIRST_UPTIME FIRST_CPU < "$COUNTER_FILE" 2>/dev/null || true
fi
case "$COUNT" in ''|*[!0-9]*) COUNT=0 ;; esac
case "$FIRST_UPTIME" in ''|*[!0-9]*) FIRST_UPTIME=$UPTIME_INT ;; esac
case "$FIRST_CPU" in ''|*[!0-9]*) FIRST_CPU=$MAIN_CPU ;; esac
COUNT=$(( COUNT + 1 ))
printf '%d %d %d\n' "$COUNT" "$FIRST_UPTIME" "$FIRST_CPU" > "$COUNTER_FILE"

ELAPSED_S=$(( UPTIME_INT - FIRST_UPTIME ))
CPU_DELTA=$(( MAIN_CPU - FIRST_CPU ))
SPINNING=no
if [ "$ELAPSED_S" -gt 0 ] && [ $(( CPU_DELTA * 100 )) -ge $(( ELAPSED_S * CLK_TCK * 50 )) ]; then
    SPINNING=yes
fi

if [ "$SPINNING" = yes ]; then
    LIMIT=$FR_WATCHDOG_KILL_AFTER
else
    LIMIT=$FR_WATCHDOG_KILL_AFTER_STALLED
fi

echo "freeradius-watchdog: no Status-Server reply (${COUNT}/${LIMIT}; main thread state=${MAIN_STATE} spinning=${SPINNING} cpu_ticks=+${CPU_DELTA} over ${ELAPSED_S}s)"

if [ "$COUNT" -lt "$LIMIT" ]; then
    exit 1
fi

# ---------------------------------------------------------------------------
# 6. Kill threshold reached: dump per-thread state, then SIGKILL.
#
#    Write to /proc/1/fd/1 (docker-init's stdout = the container log) so the
#    thread dump appears in `docker logs`.  Ignore write errors — the log may
#    not be writable in all configurations, but we must still kill.
#
#    Two passes one second apart give a before/after snapshot that makes it
#    easy to distinguish a spinning thread (utime increases) from a blocked
#    one (state D/T, wchan non-zero).
# ---------------------------------------------------------------------------
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null) || NOW="unknown"

_log() {
    # 2>/dev/null first so a failed open of /proc/1/fd/1 is silent too.
    printf '%s freeradius-watchdog: %s\n' "$NOW" "$1" 2>/dev/null >/proc/1/fd/1 || true
}

_log "FreeRADIUS PID $FR_PID did not answer Status-Server after $COUNT consecutive checks (age=${AGE_S}s, main thread state=${MAIN_STATE} spinning=${SPINNING} cpu_ticks=+${CPU_DELTA} over ${ELAPSED_S}s); sending SIGKILL"

for _pass in 1 2; do
    _log "--- thread dump pass ${_pass}/2 ---"
    for _task_stat in "/proc/$FR_PID/task"/*/stat; do
        [ -f "$_task_stat" ] || continue
        _tid="${_task_stat%/stat}"
        _tid="${_tid##*/}"
        _tstat=$(cat "$_task_stat" 2>/dev/null) || continue
        _tafter="${_tstat##*) }"
        # Remaining fields after comm: state(1) ppid(2) ... utime(12) stime(13)
        set -- $_tafter
        _tstate=${1:-?}
        _tutime=${12:-?}
        _tstime=${13:-?}
        _twchan=$(cat "/proc/$FR_PID/task/$_tid/wchan" 2>/dev/null) || _twchan="?"
        _log "  tid=$_tid state=$_tstate utime=$_tutime stime=$_tstime wchan=$_twchan"
    done
    if [ "$_pass" -eq 1 ]; then
        sleep 1
    fi
done

_log "--- last probe output ---"
# tail -3 in a pipeline — read loop to prefix each line with the watchdog tag
echo "$PROBE_OUT" | tail -3 | while IFS= read -r _line; do
    _log "  $_line"
done

# Remove counter files before kill so a post-restart healthcheck starts clean.
rm -f /tmp/wasel-fr-watchdog.*
kill -KILL "$FR_PID"
exit 1
