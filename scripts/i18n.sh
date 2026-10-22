#!/usr/bin/env bash
# Translation workflow for iso_sgc (source strings are English, Spanish lives in i18n/es_AR.po).
#   scripts/i18n.sh pot      regenerate i18n/iso_sgc.pot from the code (do this after adding/changing strings)
#   scripts/i18n.sh update   re-export i18n/es_AR.po keeping existing translations; new strings come out empty
#                            -> translate them, then `scripts/test-odoo.sh` (test_translation fails while any is empty)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ODOO_DIR="${ODOO_DIR:-$HOME/odoo_sv/odoo}"
MODE="${1:-pot}"
DB="iso_sgc_i18n_$$"; DATA="$(mktemp -d)"
cleanup() { dropdb --force --if-exists "$DB" 2>/dev/null || true; rm -rf "$DATA"; }
trap cleanup EXIT
PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')"
ADDONS="$ODOO_DIR/addons,$ODOO_DIR/odoo/addons,$HERE/addons"
cd "$ODOO_DIR"
run() { .venv/bin/python odoo-bin --addons-path="$ADDONS" --data-dir="$DATA" --http-port="$PORT" --log-level=warn "$@"; }
# the i18n subcommand only accepts --addons-path before it and its own options after it
i18n() { .venv/bin/python odoo-bin --addons-path="$ADDONS" i18n "$@"; }
# install the module (with Spanish loaded so existing translations are read from i18n/es_AR.po)
if [ "$MODE" = "update" ]; then
  run -d "$DB" -i iso_sgc --load-language=es_AR --stop-after-init --without-demo >/dev/null
  i18n export -d "$DB" -l es_AR -o "$HERE/addons/iso_sgc/i18n/es_AR.po" iso_sgc
else
  run -d "$DB" -i iso_sgc --stop-after-init --without-demo >/dev/null
  i18n export -d "$DB" -l pot -o "$HERE/addons/iso_sgc/i18n/iso_sgc.pot" iso_sgc
fi
echo "done: $MODE"
