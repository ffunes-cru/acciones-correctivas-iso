# Licensing notes (not legal advice; confirm with the company's counsel)

- **This repository's code** is licensed **LGPL-3.0-or-later** (`LICENSE`, plus `COPYING` = GPL-3.0 text that LGPL-3.0
  incorporates by reference), as decided by the project owner.
- **Directus is not linked into our code.** The UI and extensions talk to it over HTTP, and extensions use its public
  extension API. Directus is licensed under the **Business Source License 1.1**, not the GPL, so there is no GPL
  inheritance to worry about, but there *is* a usage condition (see `PLAN.md` D1). The BSL conversion to an
  open-source licence happens after a delay set by the licensor; check the current LICENSE in the Directus repo.
- **Provenance of the legacy code:** it was written by an employee and the GitHub repository is private. Before the
  licence header is applied to inherited files, confirm that the company owns the copyright (employment/work-for-hire).
  Until then the `main` baseline commit carries no licence and should be treated as proprietary.
- LGPL on an internal-only tool has no distribution trigger. It matters only if the code is ever given to a third party
  (e.g. a subsidiary that is a separate legal entity — worth checking given the multi-company list: TMC, Fertec,
  Metallo, Leaf, Fabril).
- Third-party dependencies keep their own licences; `xlsx@0.18.5` (legacy) is being dropped.
