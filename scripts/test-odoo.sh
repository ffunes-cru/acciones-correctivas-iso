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
cleanup() { dropdb --if-exists "$DB" 2>/dev/null || true; rm -rf "$DATA" "$LOG"; }
trap cleanup EXIT

ADDONS="$ODOO_DIR/addons,$ODOO_DIR/odoo/addons,$HERE/addons${EXTRA_ADDONS:+,$EXTRA_ADDONS}"
cd "$ODOO_DIR"
.venv/bin/python odoo-bin -d "$DB" --addons-path="$ADDONS" --data-dir="$DATA" \
  -i iso_sgc --test-tags=iso_sgc --stop-after-init --without-demo=all \
  --http-interface=127.0.0.1 --log-level=test >"$LOG" 2>&1 || true

grep -E "ERROR|FAIL|failed|tests [0-9.]+s" "$LOG" | tail -30
grep -q " 0 failed, 0 error(s)" "$LOG" || { echo "TESTS FAILED"; exit 1; }
echo "TESTS OK"
