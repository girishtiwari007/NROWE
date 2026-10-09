# Financial year and remembered reporting months

Restart the Python Local Sync GUI to load these controls.

- Select the financial year, completed-through month and running month.
- Successful syncs save these choices in `data/local-sync-settings.json`. On first use, the current manifest supplies the cutoff.
- Leave **Follow calendar month** off to retain a manually approved reporting cutoff. Month-change detection still refreshes with that cutoff.
- Enable it only if calendar rollover should advance the running month and mark the preceding month completed, including a zero-booking new month.
- While the GUI is open it checks the calendar every minute. It also checks on startup. A rollover during a sync queues a follow-up run.
- At a financial-year boundary, calendar mode stops and asks for the new year and matching source files; it does not silently relabel old data.
- Changing FY requires both matching CY and PY files to prevent stale prior-year comparisons. The sync checks actual-workbook year headers before publishing.
- The sync updates report labels/source paths and includes FY and month choices in the asset revision. Existing calculation and export contract checks remain in place.

Command-line example:

```powershell
python -B tools/local_portal_sync.py --source "D:\PORTAL DATA\current year" --financial-year 2026-2027 --running-month-index 5 --completed-through-index 4
```

Tests: `python -B tools/test_reporting_settings.py` and `node tools/test_calculations.cjs`.
These are automated internal checks, not a substitute for visual GUI and Excel/PDF download testing. A real future-year data package has not yet been tested end to end.
