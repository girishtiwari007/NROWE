# Validated Build Record

This file records the working portal baseline before larger future-ready changes.

## Baseline

- Portal: Ordinary Working Expenses (OWE) PORTAL - Moradabad Division
- Repository path: `D:\github\MBRLR`
- Mode: static website with local sync/export tooling
- Status: current behavior is the protected baseline

## Preserve

- all report pages and navigation
- calculations and finance rules
- current filters, search and sorting
- Current Visible View exports
- Page-wise exports
- All Visible Portal Pages combined exports
- History Compare
- Data Export tab
- export password behavior
- hidden Admin behavior
- GUI/local sync behavior

## Validation checklist

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

## Change policy

Future changes should be additive and reversible. Larger redesign should be built as a separate layer while keeping this static portal usable.
