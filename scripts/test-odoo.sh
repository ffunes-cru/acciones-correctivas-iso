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
# A random free port, so a running Odoo (e.g. your dev instance on 8069) does not collide.
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
.venv/bin/python odoo-bin -d "$DB" --addons-path="$ADDONS" --data-dir="$DATA" \
  -i iso_sgc --test-tags=iso_sgc --stop-after-init --without-demo \
  --http-interface=127.0.0.1 --http-port="$PORT" --log-level=test >"$LOG" 2>&1 &
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

grep -E "ERROR|FAIL|failed|tests [0-9.]+s" "$LOG" | tail -30 || true
if ! grep -q " 0 failed, 0 error(s)" "$LOG"; then
  echo "--- details ---"
  grep -n -B2 -A18 "Traceback" "$LOG" | head -80 || true
  echo "--- last log lines ---"; tail -15 "$LOG"
  echo "TESTS FAILED"; exit 1
fi
# Warnings coming from our own code (deprecated APIs, view lint, duplicated labels...) are failures too.
WARN="$(grep -E " (WARNING|ERROR|CRITICAL) " "$LOG" | grep -E "iso_sgc|iso\.|View error context|ir_ui_view" | head -10 || true)"
if [ -n "$WARN" ]; then echo "--- warnings from iso_sgc ---"; echo "$WARN"; echo "TESTS FAILED (warnings)"; exit 1; fi
echo "TESTS OK"
