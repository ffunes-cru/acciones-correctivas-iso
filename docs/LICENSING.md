# Licensing notes (not legal advice; confirm with the company's counsel)

- **This repository:** proprietary, internal use only (`LICENSE`; module manifest `license: Other proprietary`).
  The company owns the code (decision D6). Do not publish it.
- **Odoo Community 19** is LGPL-3.0. A separate proprietary module that uses Odoo's Python API is fine for
  internal use, and we only depend on Odoo core (`base`, `mail`).
- **No OCA (AGPL-3) modules** are used, so no AGPL obligations arise (see `docs/PLAN.md` §5). If one is added later,
  AGPL network-use terms apply to modified OCA code; internal employees are not third parties, but re-check before
  giving the system to another legal entity (e.g. if the group companies are separate entities).
- **Python/JS dependencies** (e.g. `google-api-python-client` for the Sheets export) keep their own licences.
- The legacy Firebase/React app remains at the repo root only as a reference until phase M8.
