# Mantenibilidad: app React+Firebase vs. módulo Odoo (2026-10-26)

Método: `wc -l` sobre archivos de código propios (sin `node_modules`), `radon` para complejidad ciclomática del módulo,
conteo de tokens de ramificación (`if/for/while/&&/||/case/catch`) en ambos lados. Es una aproximación, no una medida exacta.

| Concepto | Legacy (TS/TSX) | Odoo `iso_sgc` |
|---|---|---|
| Código escrito a mano (lógica + UI + seguridad + datos) | ~25 550 (`src/`, `server.ts`, `api/`, `domain/`, sin tests) | ~5 610 (models 2 719, views 1 139, data 1 026, tools 463, security 265) |
| Tests | ~250 (vitest, solo `domain/`) | 2 730 (172 tests Odoo) |
| Traducción es_AR | embebida en el código | 5 985 (generado, `.po`) |
| Documentación a mano | dispersa | 869 líneas (`docs/` del módulo) + `docs/*.md` |
| Tokens de ramificación | ~2 830 | ~490 |

**Reducción:** ~78 % menos código escrito a mano (25 550 → 5 610) para el mismo alcance M1–M4.
Los tests pasan de ~250 a 2 730 líneas: la cobertura de reglas de negocio ahora es la parte más grande del repositorio.

**Complejidad:** promedio ciclomático del módulo **A (4,8)** sobre 156 bloques. Los más altos (C, 11–17) son
`IsoCalendarTask.write`, `IsoChangeReview._check_edit_rights`, `action_decide`, `IsoCalendarShareWizard.action_send`
y `IsoAuditLine.action_confirm`: candidatos a extraer a `tools/` si siguen creciendo. Ninguno es D o peor.

**Qué ya no se mantiene:** autenticación y usuarios, API REST, UI React (archivos de 2 400–3 400 líneas),
`server.ts`, reglas de Firestore, cron de GitHub Actions, webhook de correo.

**Riesgos:** 2 % de comentarios en el código (la documentación vive en `docs/`); dependencia de Odoo 19 (cada
versión mayor exige portar); falta ejecutar M5–M8 (reportes, recordatorios, migración, cutover), que sumarán código.

**Pendiente:** M5 a M8 (ver `PLAN.md`); se dejan fuera de esta pasada por decisión del usuario.
