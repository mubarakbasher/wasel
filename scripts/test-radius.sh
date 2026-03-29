#!/bin/bash
# Test RADIUS authentication
# Run this from within the freeradius container or a machine with radtest installed
#
# Usage:
#   docker compose exec freeradius bash /scripts/test-radius.sh
#   -- or mount/copy this script into the container first

set -euo pipefail

RADIUS_HOST="${RADIUS_HOST:-127.0.0.1}"
RADIUS_SECRET="${RADIUS_SECRET:-testing123}"
PASS=0
FAIL=0

echo "============================================"
echo "  Wasel — FreeRADIUS Test Suite"
echo "============================================"
echo ""

# ---- Test 1: Valid credentials (expect Access-Accept) ----
echo "=== Test 1: RADIUS Authentication (valid credentials) ==="
OUTPUT=$(radtest testuser testpass "$RADIUS_HOST" 0 "$RADIUS_SECRET" 2>&1) || true
echo "$OUTPUT"
echo ""

if echo "$OUTPUT" | grep -q "Access-Accept"; then
    echo "[PASS] Test 1: Received Access-Accept as expected."
    PASS=$((PASS + 1))
else
    echo "[FAIL] Test 1: Expected Access-Accept but did not receive it."
    FAIL=$((FAIL + 1))
fi
echo ""

# ---- Test 2: Invalid password (expect Access-Reject) ----
echo "=== Test 2: RADIUS Reject (bad password) ==="
OUTPUT=$(radtest testuser wrongpassword "$RADIUS_HOST" 0 "$RADIUS_SECRET" 2>&1) || true
echo "$OUTPUT"
echo ""

if echo "$OUTPUT" | grep -q "Access-Reject"; then
    echo "[PASS] Test 2: Received Access-Reject as expected."
    PASS=$((PASS + 1))
else
    echo "[FAIL] Test 2: Expected Access-Reject but did not receive it."
    FAIL=$((FAIL + 1))
fi
echo ""

# ---- Test 3: Unknown user (expect Access-Reject) ----
echo "=== Test 3: RADIUS Reject (unknown user) ==="
OUTPUT=$(radtest nonexistent somepass "$RADIUS_HOST" 0 "$RADIUS_SECRET" 2>&1) || true
echo "$OUTPUT"
echo ""

if echo "$OUTPUT" | grep -q "Access-Reject"; then
    echo "[PASS] Test 3: Received Access-Reject as expected."
    PASS=$((PASS + 1))
else
    echo "[FAIL] Test 3: Expected Access-Reject but did not receive it."
    FAIL=$((FAIL + 1))
fi
echo ""

# ---- Summary ----
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
