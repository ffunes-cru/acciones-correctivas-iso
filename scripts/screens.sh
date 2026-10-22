#!/usr/bin/env bash
# Screenshots of the main screens (Odoo headless Chrome). Output dir: $1 (default ./screens).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ODOO_DIR="${ODOO_DIR:-$HOME/odoo_sv/odoo}"
OUT="$(realpath -m "${1:-$HERE/screens}")"; mkdir -p "$OUT"
DB="iso_sgc_shots_$$"; DATA="$(mktemp -d)"; LOG="$(mktemp)"
cleanup() { dropdb --force --if-exists "$DB" 2>/dev/null || true; rm -rf "$DATA"; }
trap cleanup EXIT
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
cd "$ODOO_DIR"
.venv/bin/python odoo-bin -d "$DB" --addons-path="$ODOO_DIR/addons,$ODOO_DIR/odoo/addons,$HERE/addons" --data-dir="$DATA" \
  -i iso_sgc --test-tags=iso_screens --screenshots="$OUT" --stop-after-init --without-demo=all \
  --http-interface=127.0.0.1 --http-port="$PORT" --log-level=test >"$LOG" 2>&1 &
PID=$!
for _ in $(seq 1 900); do
  grep -q "tests when loading database\|Failed to load registry" "$LOG" && break
  kill -0 "$PID" 2>/dev/null || break; sleep 1
done
kill "$PID" 2>/dev/null || true; sleep 3; kill -9 "$PID" 2>/dev/null || true
grep -E "ERROR|FAIL|Screenshot in|failed" "$LOG" | tail -30 || true
echo "Screenshots: $OUT"; find "$OUT" -name "*.png" | sort | head -40
