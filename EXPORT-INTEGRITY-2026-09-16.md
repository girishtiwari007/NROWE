# Export integrity checks — 16 September 2026

## MBRLR

Fixed invalid PowerPoint slide-master colour-map values, the layout ID range and incomplete theme style lists. Increased Blob URL lifetime to 60 seconds for slow download handlers (precaution, not a reproduced failure).

Ran the actual Excel, main PDF and PPTX export functions in a Node harness. Browser access checks and UI repaint were replaced with test stubs; data calculations and export serialization were retained. PDF charts used a real canvas implementation. This is not a browser-download or native Office test.

- Excel: 10 worksheets reopened with openpyxl; font/page-setup checks passed.
- Main PDF: 39 pages reopened and rendered without parser repair.
- SMH PDFs: both 8-page files reopened and rendered without parser repair.
- PowerPoint: ZIP CRCs, XML, relationship targets and specific OOXML rules passed.

Repeat with `node tools/smoke_all_exports.cjs`, `python -B tools/validate_export_files.py`, and `python -B tools/check_export_integrity.py`.

## User-specified Downloads files

`Moradabad_Division_Current_Year_Budget_Analysis.pptx` and `Moradabad_Division_DRM_PPT_With_Yearly_Comparison (1).pptx` belong to the separate MB-BUDGET project, not MBRLR's generator.

Both passed ZIP CRC, XML and relationship checks. The bundled python-pptx reader opened 13 and 24 slides respectively. Both differ in SHA256 from the current MB-BUDGET exports. No downloaded originals or MB-BUDGET files were changed.

Native PowerPoint repair/opening errors remain unverified. Obtain the exact error screenshot before attributing them to a cause. Do not describe this report as proof that every file opens in Microsoft Office.
