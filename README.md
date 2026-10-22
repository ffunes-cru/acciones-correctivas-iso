# Acciones Correctivas ISO

ISO quality management: findings and corrective actions, special releases (4-area sign-off), change requests,
ISO audit calendar, deadline reminders. Being rebuilt as an **Odoo 19 Community** module (`addons/iso_sgc`).

> **Status:** module M1 (findings + actions) is implemented and tested. The legacy Firebase/Vercel app is still at the
> repo root (`src/`, `server.ts`, `api/`, `firestore.rules`) as a reference and will be deleted at cutover.
> See [`docs/PLAN.md`](docs/PLAN.md) and [`docs/BEHAVIOR.md`](docs/BEHAVIOR.md).

## Layout
| Path | What |
|---|---|
| `addons/iso_sgc/` | The Odoo module (models, security, views, tests) |
| `scripts/test-odoo.sh` | Runs the module's tests on a throw-away database |
| `docs/` | Plan, behaviour inventory (the test spec), licensing |
| `Dockerfile`, `compose.yaml` | Dev image: Odoo 19 + the addon + PostgreSQL |
| `domain/` | Legacy TypeScript rules + tests, kept only as a spec for the modules not yet ported |
| legacy: `src/`, `server.ts`, `api/` | Old app, reference only |

## Use in an existing Odoo 19
Add `<this repo>/addons` to `addons_path`, update the app list, install **ISO SGC**, then give users the group
*ISO SGC / User* (or *Administrator*).

## Test
```bash
ODOO_DIR=~/odoo_sv/odoo ./scripts/test-odoo.sh     # needs a local PostgreSQL reachable by your user
```

## Licence
Proprietary, internal use only. See [`LICENSE`](LICENSE) and [`docs/LICENSING.md`](docs/LICENSING.md).
