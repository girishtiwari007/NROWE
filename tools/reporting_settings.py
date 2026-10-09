"""Reporting choices shared by GUI tests; manual cutoffs are never auto-closed."""
import json
from pathlib import Path


def load_settings(root):
    path = Path(root) / 'data/local-sync-settings.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    manifest = Path(root) / 'data/mb-budget-sync/sync-manifest.json'
    data = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {}
    status = data.get('monthStatus', {})
    return {'financial_year': data.get('financialYear', '2026-2027'),
            'running': status.get('reportingMonthIndex'),
            'completed': status.get('completedMonthCount', 0) - 1,
            'follow_calendar': False}


def save_settings(root, settings):
    path = Path(root) / 'data/local-sync-settings.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(settings, indent=2), encoding='utf-8')
    temp.replace(path)


def calendar_cutoff(year, now):
    start = int(str(year).split('-')[0])
    calendar_year = now.year if now.month >= 4 else now.year - 1
    if calendar_year != start:
        raise ValueError('Calendar moved outside the selected financial year. Select the new FY and its source files before syncing.')
    running = (now.month - 4) % 12
    return running, running - 1
