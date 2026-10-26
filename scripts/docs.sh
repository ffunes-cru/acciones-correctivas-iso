#!/usr/bin/env bash
# Regenerate docs/referencia.md from Odoo's own metadata (throw-away DB) and, if doxygen is installed, the HTML site.
#   scripts/docs.sh          -> addons/iso_sgc/docs/referencia.md  (commit it; tests fail when it is stale)
#   scripts/docs.sh html     -> also builds addons/iso_sgc/docs/_doxygen/html/index.html
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ODOO_DIR="${ODOO_DIR:-$HOME/odoo_sv/odoo}"
DB="iso_sgc_docs_$$"; DATA="$(mktemp -d)"
cleanup() { dropdb --force --if-exists "$DB" 2>/dev/null || true; rm -rf "$DATA"; }
trap cleanup EXIT
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
cd "$ODOO_DIR"
.venv/bin/python odoo-bin -d "$DB" --addons-path="$ODOO_DIR/addons,$ODOO_DIR/odoo/addons,$HERE/addons" --data-dir="$DATA" \
  --http-port="$PORT" --log-level=warn -i iso_sgc --stop-after-init --without-demo >/dev/null
echo "from odoo.addons.iso_sgc.tools.documentacion import escribir; print(escribir(env))" | \
  .venv/bin/python odoo-bin shell -d "$DB" --addons-path="$ODOO_DIR/addons,$ODOO_DIR/odoo/addons,$HERE/addons" \
  --data-dir="$DATA" --http-port="$PORT" --log-level=warn 2>/dev/null | tail -1
if [ "${1:-}" = "html" ]; then (cd "$HERE/addons/iso_sgc" && doxygen && echo "HTML: $HERE/addons/iso_sgc/docs/_doxygen/html/index.html"); fi
