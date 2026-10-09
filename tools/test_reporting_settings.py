"""Headless tests; no production data changes."""
import ast
import json
import tempfile
import subprocess
import unittest
from datetime import datetime
from pathlib import Path
from reporting_settings import calendar_cutoff, save_settings, load_settings
from local_portal_sync import rebase_reporting_year


class ReportingTests(unittest.TestCase):
    def test_calendar(self):
        for month, expected in [(4, 0), (9, 5), (12, 8)]:
            self.assertEqual(calendar_cutoff('2026-2027', datetime(2026, month, 1)), (expected, expected-1))
        self.assertEqual(calendar_cutoff('2026-2027', datetime(2027, 1, 1)), (9, 8))
        self.assertEqual(calendar_cutoff('2026-2027', datetime(2027, 3, 31)), (11, 10))
        with self.assertRaises(ValueError):
            calendar_cutoff('2026-2027', datetime(2027, 4, 1))

    def test_remember_manual_cutoff(self):
        with tempfile.TemporaryDirectory() as folder:
            values = {'financial_year': '2026-2027', 'running': 5, 'completed': 4, 'follow_calendar': False}
            save_settings(folder, values)
            self.assertEqual(load_settings(folder), values)

    def test_manifest_bootstrap(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'data/mb-budget-sync/sync-manifest.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'financialYear':'2027-2028','monthStatus':{'reportingMonthIndex':0,'completedMonthCount':0}}))
            self.assertEqual(load_settings(folder)['completed'], -1)
            self.assertEqual(load_settings(folder)['running'], 0)

    def test_year_labels_not_amounts(self):
        source = "let BUDGET = {\"01\":2026};\nconst DEFAULT_DATA_AS_ON_DATE = new Date('2026-09-15');\nconst x = i<=8?2026:2027;\nconst label='FY 2026-27 / PY 2025-26 / APR 2026 / JAN 2027';\n"
        changed = rebase_reporting_year(source, '2026-2027', '2027-2028')
        self.assertIn('{"01":2026}', changed)
        self.assertIn("new Date('2026-09-15')", changed)
        self.assertIn('i<=8? 2027: 2028', changed)
        self.assertIn('FY 2027-28 / PY 2026-27 / APR 2027 / JAN 2028', changed)
        self.assertEqual(rebase_reporting_year(changed, '2027-2028', '2027-2028'), changed)

    def test_python_syntax(self):
        for name in ('mbrlr_sync_gui.py', 'local_portal_sync.py', 'reporting_settings.py'):
            ast.parse((Path(__file__).parent / name).read_text(encoding='utf-8'))

    def test_future_portal_syntax(self):
        root = Path(__file__).resolve().parents[1]
        source = (root / 'assets/js/app.js').read_text(encoding='utf-8')
        future = rebase_reporting_year(source, '2026-2027', '2027-2028')
        subprocess.run(['node', '--check'], input=future, text=True, encoding='utf-8', check=True, capture_output=True)
        self.assertIn('FY2027-28_', future)
        self.assertIn('source-files/2027-2028/', future)

    def test_busy_rollover_queued(self):
        from mbrlr_sync_gui import SyncApp
        class Fake:
            _sync_running = True
            _pending_month_refresh = False
            def start_sync(self):
                raise AssertionError('must not start a concurrent sync')
        fake = Fake()
        SyncApp._request_month_refresh(fake)
        self.assertTrue(fake._pending_month_refresh)


if __name__ == '__main__':
    unittest.main()
