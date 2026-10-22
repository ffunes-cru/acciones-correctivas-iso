# Acciones Correctivas ISO

ISO quality management: findings and corrective actions, special releases (4-area sign-off), change requests,
ISO audit calendar, deadline reminders.

> **Status: re-platform in progress** on branch `replatform/directus`. The legacy Firebase/Vercel app is still at the
> repo root (`src/`, `server.ts`) and will be removed in phase 4. See [`docs/PLAN.md`](docs/PLAN.md).

## Layout
| Path | What |
|---|---|
| `domain/` | Pure business rules + unit tests (the part we really maintain) |
| `extensions/` | Directus hooks/endpoints (thin; import `domain/`) |
| `ui/` | New UI (phase 3) |
| `docs/` | Plan, behaviour inventory, licensing notes, Directus upgrade policy |
| `Dockerfile`, `compose.yaml`, `docker/` | Images: `directus` (with extensions) and `web` (nginx + UI) |
| legacy: `src/`, `server.ts`, `api/`, `firestore.rules` | Old app, reference only |

## Run
```bash
cp .env.example .env              # fill in values; generate KEY/SECRET with: openssl rand -hex 32
docker compose --profile dev up -d --build   # dev: includes a throwaway SQL Server
# production: point DB_* at the company SQL Server and run without --profile dev
```
Directus: http://localhost:8055

## Test
```bash
cd domain && npm ci && npm test
```

## Licence
Proprietary, internal use only. See [`LICENSE`](LICENSE) and [`docs/LICENSING.md`](docs/LICENSING.md).
