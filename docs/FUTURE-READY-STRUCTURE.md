# Future-Ready Structure Plan

The current static OWE portal is the validated base. Future GUI, API, database, and visual-design work should be added around it, not by replacing working calculations/export behavior in one jump.

## Core rule

The current portal must remain recoverable and usable at all times.

Future work must preserve:

- calculations and totals
- RG/BG finance rule behavior
- completed/running month behavior
- filters, sorting, hover and row highlight behavior
- Current View, Page-wise, Combined and History Compare exports
- History Compare snapshots
- GUI/local sync behavior
- export password and hidden Admin behavior

## Recommended structure

```text
MBRLR/
├── index.html
├── assets/
├── data/
│   ├── live/
│   ├── source-files/
│   └── mb-budget-sync/
│       ├── current/
│       └── history/
├── exports/
│   ├── current-view/
│   ├── page-wise/
│   ├── combined/
│   └── history-compare/
├── tools/
├── config/
├── docs/
└── archive/
    └── validated-builds/
```

## Acceptance checks before future changes

```text
node --check assets/js/app.js
node --check assets/js/display-export.js
node tools/test_calculations.cjs
node tools/test_display_exports.cjs
node tools/test_history_compare.cjs
node tools/smoke_all_exports.cjs
python tools/validate_export_files.py .export-validation
python tools/check_export_integrity.py .export-validation
```

## Future direction

1. Keep current static portal deployable.
2. Standardize sync output contract.
3. Move configurable rules into `config/` gradually.
4. Add DB/API only after current outputs are reproducible.
5. Add advanced visual design after validation is protected.
