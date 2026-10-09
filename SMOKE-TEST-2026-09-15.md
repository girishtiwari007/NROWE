# Latest-data refresh — 15 September 2026

Source: `D:\PORTAL DATA\current year` (six current-year Excel files).
Refresh used the same `write_outputs` sync engine called by the desktop GUI; GUI buttons were not operated in this test. Previous-year data was retained.

Reporting cutoff: **August 2026 completed; September 2026 running**.

## Passed

- Source sync: 47 budget rows, 40 monthly PU rows, 913 detail rows and 12 demand rows.
- Generated-data calculation, portal and export contract gates.
- JavaScript syntax and 41 operational PU calculation checks.
- Seven liability scenarios, including negative running-month adjustments.
- Per-PU RG/BG selection checks across all 12 months.
- Actual PowerPoint generation and monthly-to-total reconciliation.
- Local portal responds with HTTP 200.

## Fix applied

Preserve signed running-month bookings instead of clamping negative adjustments to zero. Use cumulative-minus-completed actuals only when the running-month field is absent. Added a regression test and changed the asset revision to refresh cached portal code.

## Verification limits

Contract checks are not visual tests. Direct GUI interaction, every-page browser operation, and actual browser Excel/PDF downloads could not be verified because browser control was restricted. Do not describe these as passed or claim 100% accuracy from this smoke test. No commit or push performed.
