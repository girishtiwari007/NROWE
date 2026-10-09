# Future Roadmap

## Phase 1 — Protect current static portal

- Keep current website working.
- Keep smoke tests available.
- Add documentation and config skeleton only.

## Phase 2 — Strengthen local sync

- Ensure every GUI/local sync creates a full snapshot.
- Store source file hashes.
- Store manifest and validation result.
- Keep History Compare working from snapshots.

## Phase 3 — Configurable rules

Move hardcoded settings gradually into config files:

- financial year
- completed month / running month
- skipped PUs
- RG/BG finance rule
- export formatting
- page names/order
- important PU list

## Phase 4 — Local DB/API

Add backend only after current outputs are reproducible.

Suggested components:

```text
backend/api/upload
backend/api/sync
backend/api/reports
backend/api/exports
backend/api/history
backend/services/parser
backend/services/calculator
backend/services/validator
backend/services/exporter
```

## Phase 5 — Advanced visual design

- page layout editor
- report column editor
- chart designer
- saved views
- presentation mode
- officer review mode
- dynamic AI finance insights

## Phase 6 — Multi-user official system

- user roles
- audit log
- approval workflow
- scheduled sync
- central database
- API deployment

## Non-negotiable

The validated static portal must remain recoverable and usable even if future API/database work is incomplete.
