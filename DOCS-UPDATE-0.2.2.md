# Perla explanation update 0.2.2

Scope: public explanations, documentation, navigation and layout for the existing
VPS 0.2.1 mining implementation. This is a content release; package dependency
versions, protocol admission, API handlers, database, verifier and contracts are
unchanged.

New pages: /participate, /whitepaper (protocol notes), /status.
Homepage and /docs now explain workloads, proof scope, costs, contribution rules,
funded settlement, operator trust, validation gates, glossary and common questions.

Reference reviewed: https://vearl.org/, https://vearl.org/whitepaper,
https://vearl.org/participate/. The reference informed information structure only.
The copy describes Perla's existing implementation. Vearl's consensus, hardware
support, measurements and token-allocation promises are not Perla features.

Validation of this content release:
- Production Next.js build and TypeScript passed.
- Existing 7 production HTTP checks passed with all new page routes added.
- Main page H1 structure, cross-page anchors and download targets checked.
- Desktop browser QA: homepage, opening FAQ answers and protocol notes.
- Scoped updater preflight, repeat application, backup/rollback, and preservation
  of local environment/database files checked separately in a test directory.

The 60-check baseline published at /status is the existing VPS 0.2.1 software
record. It is not presented as a new GPU, performance or economic measurement.
Mining activation still depends on deployment validation and operator settings.
