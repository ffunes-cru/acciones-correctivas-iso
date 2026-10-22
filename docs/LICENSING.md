# Licensing notes (not legal advice; confirm with the company's counsel)

## This repository
**Proprietary, internal use only** (`LICENSE`; `"license": "UNLICENSED"` in package manifests), decision D6.
The company owns the code. It can be relicensed later (an earlier draft chose LGPL-3.0; nothing in the stack requires it).
Do not push the images or source to public registries/repos.

## Directus (the main third-party component)
- Version pinned: 12.5.0 (see `docs/UPGRADES.md`). Licence: **MSCL-1.0-GPL** (Monospace Sustainable Core License).
- Internal use is a stated *Permitted Purpose*; the only excluded use is a **Competing Use** (offering Directus itself to
  parties that compete with Directus's commercial offering). Our use is not that.
- **License-key limitations:** we must not circumvent or disable licence-key-gated functionality. Directus gates features
  and limits by tier (Core / Open Innovation Grant / paid). Details, numbers and the open questions are in
  `docs/PLAN.md` §6 D1. Whether the company needs a paid key is the main open licensing item.
- **Redistribution:** copies/derivatives of Directus carry MSCL terms and may not be sold or sub-licensed with extra
  charges. Our images are internal only. Our extensions use Directus's public extension API and are separate works we
  own; keep them out of any public distribution.
- **Future licence:** each Directus version becomes GPL-3.0 four years after release, a long-term safety net if the
  vendor changes terms: the pinned version stays usable.
- Verify against the LICENSE file shipped in the pinned image and the pricing/OIG pages before production.

## Other
- npm dependencies keep their own (mostly MIT) licences; run a licence report (`npx license-checker`) before go-live.
- Multi-company group (TMC, Fertec, Metallo, Leaf, Fabril): Directus's grant is assessed per *legal entity* of
  Studio users. Ask whether all five are one legal entity or separate ones when the licence question is answered.
