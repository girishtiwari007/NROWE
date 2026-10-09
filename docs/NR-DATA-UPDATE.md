# NR Zone data update and coverage

Current year: 2026-2027. Previous year: 2025-2026. Zone 03 and 22 AUs use scope-matched payloads. Comparisons use the shared current-year completed reporting period even for an AU with zero expenditure. September FR views use April–September explicitly.

Source configuration: tools/nr-source-config.json. Rebuild command: node tools/sync_nr_all.cjs, or SYNC-NR-ZONE-LOCAL.bat. Replace the configured reports in their year folders and rerun; renamed files require a configuration update. A future financial-year rollover also requires the portal's year/period labels to be updated; this release remains FY 2026-27.

Prior-year department-budget coverage is incomplete for AU 0325 because the file ends at row 32768 inside that AU; later uncovered AU budgets and AU 0319 are unavailable. Their supplied monthly actuals remain usable. Named zonal departmental budgets remain unavailable because budget records are coded department 00. Missing budgets/actuals are not substituted with zero in comparisons.

PU and monthly PU controls reconcile to the source totals within recorded integer-thousand rounding tolerances. Net OWE Demand/FR views exclude Suspense. Operational PU views keep their existing display exclusions. All values are stored as rupees thousands and shown in crore by dividing by 10000.

Every financial report and FR page has a matched-year comparison, with independent AI Insight filters and PY movement comments. Each comparison can be exported alone to Excel, PDF or editable PPT tables. Graph PY series use matching completed months.

Cleanup: eight redundant single-AU source copies, legacy history/test metadata and old embedded detail/demand values were retired. Source copies and retired values were preserved in the chat workspace recovery folder. Compatibility script filenames remain but contain no legacy financial values.
