# Displayed report exports

MBRLR only. Data Export is visible page 12 and Portal Admin is page 13. The existing eleven reporting pages are preserved; Remarks and Backup remain accessible through Portal Admin.

Use the page list in **Data Export** for Excel/PDF/PPT. Export controls are no longer added to individual pages or the common header. Set filters first; navigating directly to Data Export preserves filters. Each page-wise or combined Data Export file contains only report titles, export metadata, table headers, visible table rows and table formatting. Cards, narrative page content, summary slides and duplicated chart slides are excluded. Graph pages export their underlying chart values as tables. Summary is excluded because it has no structured table. No report data is changed by exporting.

Excel stores displayed numbers as editable cells, with identifiers preserved as text. It does not reconstruct source formulas from displayed values. Times New Roman is 10 pt; print scale remains 100%, wide tables are split into bands with identifying columns repeated, and headers repeat on subsequent sheets/pages.

PDF embeds Times New Roman from the local font assets and falls back to built-in Times if a font asset cannot be fetched. PDF content is paginated instead of reducing the minimum font size. Data Export PowerPoint uses native editable tables, larger titles and a plain official-report layout.

Downloaded files are snapshots, not live links to the portal. Units and displayed precision are retained. Pages without a structured table or chart-data table are omitted from the Data Export matrix.

The SMH matrix now has a single dual-unit PDF option: thousands at 10 pt and crores at 8 pt beneath, in the same numeric cell. This is the user-approved exception to the minimum 10 pt rule; variance colours are retained. Older downloaded single-unit reports are not automatically replaced.

Internal test: `node tools/test_display_exports.cjs`. This covers real source rows, wide-column coverage, editable numeric values, PDF font embedding and export generation. Test files in `.export-validation/display` use 30 source records and are layout samples, not complete production reports.

The sync engine blocks publication if the table-only rules, login gates, freshness guards or required export functions are removed. Live browser smoke testing still verifies tab rendering, navigation search, filters, sorting and Data Export controls after each development update.
