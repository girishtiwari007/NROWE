# Division/AU and PU report filters

Use the shared filter ribbon on financial report pages. Select one or more Division/AU checkboxes. Multiple AUs default to Separate AUs: each report and previous-year comparison shows Division/AU name in the first column, with that AU's own values and subtotal. Use AU view > Combined for consolidated figures. Select Zone only to return to NR Zone totals. All AUs selects the 22 AUs; Six Divisions selects DLI, FZR, JAT, LKO, MB and UMB. Zone and AU selections are exclusive, preventing the Zone total from being added to its constituent AUs.

The PU mode offers All PUs, Staff PU, Non Staff PU and Specific PU(s). Specific PU(s) opens a searchable checkbox menu for one or several PUs. These selections remain active when navigating between financial pages and combine with the existing liability, activity, importance and utilisation controls. Existing report exclusions are retained. Demand summaries have no PU-level source grain, so their ribbon hides PU controls and uses Demand fields instead.

Filter by offers text matching or numeric Above/Below/Equals for the fields available on the current page. Amount thresholds are in crore; utilisation thresholds are percentages. Sort by supports ascending or descending order. Field and sort settings are retained per page. Department reports preserve their Department/Demand grouping when sorting detail rows.

PU Master opens in Table View. Card View remains available during the session. Clear filters resets the active page's field settings and PU-type selection, while keeping the selected AU scope and existing importance preference.

FR Review has the same AU checkbox menu for its selected-AU review. Expenditure Monitoring and AI Insight retain their independent AU/head checkbox controls and do not inherit unrelated ribbon filters.

Separate reports run each AU's own calculations against its matching current/previous-year data. Combined figures retain AU-level RG/BG fallback before aggregation, including explicit zero grants. Current/previous-year comparisons use the matching AU set. Missing source coverage remains flagged and is not represented as complete data. Exports record AU codes, PU selections, field filters, sorting and partial-coverage notices. Session saved views restore these settings.

Verification: run `node tools/test_nr_multiselect.cjs` and `node tools/test_nr_au_views.cjs` against the local portal, alongside `node tools/test_calculations.cjs` and `node tools/test_nr_portal.cjs`. Set `NR_TEST_OUTPUT` to keep browser downloads outside the repository. The multi-selection test includes independent source totals, mixed RG/BG and zero-grant cases, shared checkbox interactions, cross-page filtering, comparison sorting, mobile layout and real Excel/PDF/PPT downloads.

The AU view setting is retained in saved views and browser preferences. Sorting keeps AU groups and their subtotal rows together. The AU name stays visible when horizontally scrolling wide separate tables. PU hover/detail views use the row's AU. Graph and BI views show AU-labelled series/tables. FR Monitoring and AI Insight keep their independent selections and show AU names first.
