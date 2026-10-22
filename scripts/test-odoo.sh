#!/usr/bin/env bash
# Run the iso_sgc test-suite against an Odoo 19 checkout, on a throw-away database.
#   ODOO_DIR   Odoo source dir (default: ~/odoo_sv/odoo, expects .venv inside)
#   EXTRA_ADDONS  extra comma-separated addons paths (OCA etc.), optional
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ODOO_DIR="${ODOO_DIR:-$HOME/odoo_sv/odoo}"
DB="iso_sgc_test_$$"
DATA="$(mktemp -d)"
LOG="$(mktemp)"
cleanup() { dropdb --force --if-exists "$DB" 2>/dev/null || true; rm -rf "$DATA" "$LOG"; }
trap cleanup EXIT

ADDONS="$ODOO_DIR/addons,$ODOO_DIR/odoo/addons,$HERE/addons${EXTRA_ADDONS:+,$EXTRA_ADDONS}"
cd "$ODOO_DIR"
# --no-http: tests don't need the web server, and it can keep the process from exiting.
.venv/bin/python odoo-bin -d "$DB" --addons-path="$ADDONS" --data-dir="$DATA" \
  -i iso_sgc --test-tags=iso_sgc --stop-after-init --without-demo=all \
  --no-http --log-level=test >"$LOG" 2>&1 &
PID=$!
# Stop as soon as the result line is printed (or the process ends / 15 min pass).
for _ in $(seq 1 900); do
  grep -q "tests when loading database\|Failed to load registry" "$LOG" && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done
# Odoo sometimes hangs on shutdown after the tests ran: ask nicely, then insist.
kill "$PID" 2>/dev/null || true
for _ in 1 2 3 4 5; do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
kill -9 "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true

grep -E "ERROR|FAIL|failed|tests [0-9.]+s" "$LOG" | tail -30
if ! grep -q " 0 failed, 0 error(s)" "$LOG"; then
  echo "--- details ---"
  grep -n -B2 -A18 "Traceback" "$LOG" | head -80
  echo "TESTS FAILED"; exit 1
fi
echo "TESTS OK"
