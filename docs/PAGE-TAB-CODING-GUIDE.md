# Page / Tab Coding Guide

This guide maps each visible portal tab to the files and functions a future coder should touch when making a page-specific change. The portal is a static build, so `index.html` and `assets/js/app.js` are currently authoritative.

## Safe change rule

Change one page in this order:

1. Find the tab ID, for example `liability`.
2. Edit only that page's HTML block in `index.html`: `id="tab-liability"`.
3. Edit only that page's render function in `assets/js/app.js`.
4. Edit only the matching CSS section/selectors in `assets/css/main.css`.
5. If exports should change, update the matching export route in `assets/js/app.js` or `assets/js/display-export.js`.
6. Run validation:

```text
node --check assets/js/app.js
node --check assets/js/display-export.js
python -m py_compile tools/local_portal_sync.py tools/mbrlr_sync_gui.py
node tools/test_history_compare.cjs
node tools/test_display_exports.cjs
node tools/smoke_all_exports.cjs
python tools/validate_export_files.py .export-validation
python tools/check_export_integrity.py .export-validation
```

Do not change calculation rules, source parsing, sync behavior, or export passwords while doing a visual/page-specific edit unless the change request explicitly says so.

## Navigation locations

Primary report menu:

- `index.html` buttons with `data-report-tab="PAGE_ID"`.

Legacy hidden tab list:

- `index.html` `.legacy-tabs` entries using `onclick="switchTab('PAGE_ID')"`.

Page container:

- `index.html` block with `id="tab-PAGE_ID"`.

Switching/routing:

- `assets/js/app.js` function `switchTab(name)`.
- `assets/js/app.js` report labels/maps near `REPORT_TITLES` / report menu helpers.

## Page map

| Page ID | Visible label | HTML block | Main JS render/change area | Main data source | Export notes |
|---|---|---|---|---|---|
| `summary` | Summary | `#tab-summary` | `renderSummaryPage()`, `renderCards()`, `renderRiskSpotlight()` | `BUDGET`, `MONTH`, derived KPIs | Current View uses visible cards/tables through display export helpers. |
| `liability` | OWE Statement / Main Report | `#tab-liability` | `renderLiabilityHeader()`, `renderLiability()`, `renderBIView()` | `BUDGET`, `MONTH`, PU master list | Master Excel/PDF/PPT handled in `downloadExcel()`, `downloadPDFReport()`, `downloadPowerPoint()`; current-view exports use `DisplayExport`. |
| `smhdetail` | Department wise | `#tab-smhdetail` | `renderSMHDetail()`, `renderSMHReportRows()` | `assets/js/detail-data.js` / `window.DETAIL_SMH_DATA` | Master exports include Department wise sheet/pages. |
| `demandsmh` | Demand wise | `#tab-demandsmh` | `renderDemandSMHSummary()` | `assets/js/demand-smh-data.js` / `window.DEMAND_SMH_SUMMARY_DATA` | Master exports include Demand wise sheet/pages. |
| `pumaster` | PU Master / PU Master & Status | `#tab-pumaster` | `renderPUMaster()` | PU master list plus `BUDGET`/`MONTH` | Master Excel/PDF/PPT include PU Master annexure. |
| `monthwise` | Month-wise Actuals | `#tab-monthwise` | `renderMonthwise()` | `MONTH`, `BUDGET` | Note: `assets/js/app.js` contains more than one historical `renderMonthwise()` definition; the later definition is the effective one in browser execution. |
| `bpanalysis` | BP Analysis | `#tab-bpanalysis` | `renderBPAnalysis()` | `BUDGET`, `MONTH`, reporting month status | Keep completed/running month logic unchanged unless specifically requested. |
| `budgetcontrol` | Budget Control | `#tab-budgetcontrol` | `renderBudgetControl()` | `BUDGET`, derived pressure/control rows | Exported in master reports. |
| `excessshortfall` | AE vs BP | `#tab-excessshortfall` | `renderExcessShortfall()` | `BUDGET`, `MONTH`, PY comparison where available | Keep column references and dual-unit values consistent. |
| `trend` | Graphs / Trend Analysis Graphs | `#tab-trend` | `renderTrend()`, `renderTrendFallback()` | `BUDGET`, `MONTH`, `BUDGET_PY`, `MONTH_PY` | Chart exports should include visible graph data, not unrelated raw data. |
| `aitrend` | AI Summary | `#tab-aitrend` | `renderAITrendSummary()`, `renderAIAnomalyPanel()` | Derived from current loaded portal data | AI text is rule-based local commentary, not external AI/API output. |
| `dataexport` | Data Export | `#tab-dataexport` | `renderDataExport()`, `showDataExportPanel()`, master download functions | All visible page datasets | Combined all-page exports belong here only. Current page exports should not trigger all-page combined export. |
| `historycompare` | History Compare | `#tab-historycompare` | `renderHistoryCompare()`, `renderHistoryCompareRows()`, `downloadHistoryCompareExport()` | `data/mb-budget-sync/history/history-index.json` and snapshot folders | Keep From Sync / To Sync selection, filters and sort order respected. |
| `additionalremarks` | Additional Remarks | `#tab-additionalremarks` | `renderAdditionalRemarks()` | `SOURCE_REGISTER`, rule/source notes | Main pages should not duplicate remarks already moved here. |
| `remarks` | Remarks / Clarification | `#tab-remarks` | `renderRemarks()` | `SOURCE_REGISTER`, PU/source rules | Hidden/legacy support page; avoid reintroducing duplicate notes to main pages. |
| `backup` | Portal Backup | `#tab-backup` | `renderBackupPage()`, `downloadPortalBackup()` | Static repo files in browser package | Admin-protected. Do not expose upload controls here. |
| `admin` | Portal Admin | `#tab-admin` | `renderAdminDesign()`, admin config helpers | `assets/js/admin-config.js`, local browser settings | Hidden/admin-only behavior must remain unchanged. |

## CSS guide

Global layout and toolbar:

- `assets/css/main.css`
- Report menu selectors: `.report-menu`, `.report-menu-btn`, `.report-menu-actions`.
- Smart toolbar selectors: `.smart-tools`, `.quick-search`, `.smart-actions`, `.current-view-export`.
- Table baseline selectors: `.twrap`, `.sortable-table`, page-specific table classes.

Page-specific CSS anchors:

- PU Master: comment `/* PU Master & Status */`.
- History Compare: comment `/* History Compare */`.
- Department/Demand/SMH tables: search for `.smh-table`, `.demand-smh-table`.
- AI Summary tables/cards: search for `.ai-month-table`, `.ai-pu-card`.

## Data and sync guide

Live portal values are generated by `tools/local_portal_sync.py`:

- Main JS assignments in `assets/js/app.js`: `BUDGET`, `MONTH`, `BUDGET_PY`, `MONTH_PY`, `ASSET_VERSION`.
- Department wise data: `assets/js/detail-data.js`.
- Demand wise data: `assets/js/demand-smh-data.js`.
- Processed payload/manifest: `data/mb-budget-sync/processed/`, `data/mb-budget-sync/sync-manifest.json`.
- History snapshots: `data/mb-budget-sync/history/`.

The sync pipeline validates:

- calculations reconcile,
- all money values are normalized as integer Rs `'000`,
- all required pages exist,
- export rules are present,
- snapshot/history files are updated.

If a page needs new data, add it to the sync output first, then render it from the page function. Do not manually edit generated numbers in `assets/js/app.js`, `detail-data.js`, or `demand-smh-data.js`; rerun local sync instead.

## Export guide

Current View exports:

- Main route: report/export selector in `index.html`.
- Browser export engine: `assets/js/display-export.js`.
- Should export active page visible/filter/sort state only.

Master exports:

- Excel: `downloadExcel()` in `assets/js/app.js`.
- PDF: `downloadPDFReport()` in `assets/js/app.js`.
- PowerPoint: `downloadPowerPoint()` / `buildPowerPointBlob()` in `assets/js/app.js`.

History Compare exports:

- `downloadHistoryCompareExport(format)` in `assets/js/app.js`.

Export behavior rules are documented in `docs/EXPORT-RULES.md`.

## Add a new page/tab checklist

1. Add primary menu button in `index.html` with `data-report-tab="newid"`.
2. Add hidden legacy tab entry if still needed.
3. Add page container: `<div class="tab-content" id="tab-newid">...</div>`.
4. Add render function in `assets/js/app.js`: `renderNewPage()`.
5. Call it from `switchTab(name)` when `name === 'newid'`.
6. Add label mappings in report title/menu maps.
7. Add export behavior in `assets/js/display-export.js` or master export functions if required.
8. Add source/remarks text to `renderAdditionalRemarks()` if needed.
9. Add page to `config/page-map.json` only after the HTML/JS page is working.
10. Run the validation checklist above.
