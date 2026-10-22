# Directus version policy (decision D7)

**Pinned:** Directus `12.5.0` (released 2026-10-07), image digest
`sha256:7de5d6898b955dab1672619aed590035dcade4f8d7396d913e55543e114d1331` (amd64 + arm64).
Both live in the `Dockerfile` (`DIRECTUS_VERSION`, `DIRECTUS_DIGEST`). Floating tags (`12`, `latest`) are forbidden.

## Cadence
- **Patch/minor:** review monthly (Dependabot opens the PR weekly). Skip freely; do not fall more than 2 minors behind.
- **Major (13+):** treat as a project. Read the migration guide and the licence terms first (v12 changed licence from BSL to MSCL).
- **Security advisories:** apply within a week.

## Procedure
1. Read the release notes between the current and target version; note schema migrations, removed env vars, and any
   **licence or tier-limit changes** (seats, collections, flows, permission features).
2. Bump version and digest together (digest: `curl -s https://hub.docker.com/v2/repositories/directus/directus/tags/<ver>`, field `digest`).
3. `docker compose --profile dev up --build`, then run `domain` unit tests and the API integration tests (phase 2+).
4. **Back up the SQL Server database first.** Directus migrates the schema on boot and does not support downgrades.
5. Deploy. Smoke test: login, create finding, a Flow/hook mail, Sheets export.
6. Rollback = redeploy the previous pinned image **and restore the pre-upgrade backup**.

## Hygiene
- Keep the image in a private registry only (MSCL redistribution terms attach to copies of Directus).
- Extensions are built against the pinned version; re-test them on every bump.
