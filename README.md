# NR Zone Ordinary Working Expenses Portal

This repository is maintained in D:\github\NROWE. GitHub publication is separate from the local data workflow. Publish only to the dedicated NROWE repository; the data sync never pushes or mirrors another repository.

## Local portal

Serve this repository with a local HTTP server. Current preview: http://127.0.0.1:8874/ . Refresh the browser after a successful data sync.

## Update source data

1. Replace the current-year reports in data/mb-budget-sync/source-files/2026-2027 and previous-year reports in data/mb-budget-sync/source-files/2025-2026.
2. Keep the twelve Zone/AU report filenames per year listed in tools/nr-source-config.json, or edit that configuration when names change. Roles are PU budget, PU monthly actual, department budget, department monthly actual, Demand budget and Demand monthly actual, for Zone and AUs.
3. Run SYNC-NR-ZONE-LOCAL.bat. Both year builds validate before payload publication; the sync records source SHA-256 hashes, scope coverage and rounding reconciliation. It creates scoped recovery copies in data/mb-budget-sync/nr-history. It never contacts GitHub or writes another repository.
4. Reload the portal. Reporting month follows the latest populated current-year actual month; FR Review remains explicitly September 2026.

The old START-MBRLR-LOCAL-SYNC.bat now redirects to this NR workflow. The legacy Python single-AU sync is disabled in this repository. The detail/demand compatibility scripts contain no old Moradabad values; the selected NR payload supplies their data.

## Previous-year comparisons

All financial report pages include a matching-period comparison table and export it through Excel/PDF/PPT. Graphs, AI Trend and AE vs BP also use the selected scope's previous-year PU datasets. FR Review, Expenditure Monitoring and AI Insight compare April–September 2026 against April–September 2025. Full previous-year actuals are retained for explicitly labelled annual AE columns. Comparisons do not combine Zone totals with AU totals.

Missing data is shown as unavailable. The previous-year department-budget all-AU workbook ends at row 32768 inside AU 0325. That AU's partial budget and subsequent uncovered AU budgets are not used for comparison; department monthly actuals remain available. Zonal named-department budgets are coded 00 and are not allocated to named departments.

## Validation and exports

Run tools/test_calculations.cjs for calculation scenarios. The NR portal simulation checks all 23 scopes, financial pages, FR views, filters and editable Excel/PDF/PPT exports. Export access retains the existing portal login/confirmation controls. The main navigation labels can be selected and copied.

Use the Export comparison buttons beside each year-comparison table for compact Excel/PDF/PPT reports. The ordinary page export retains the full current report plus the year comparison. Run node tools/test_nr_portal.cjs while the local server is running (Edge and Playwright required); NR_PORTAL_URL and NR_PLAYWRIGHT can override the local URL and browser library. Results are written to data/mb-budget-sync/nr-test-output by default.
