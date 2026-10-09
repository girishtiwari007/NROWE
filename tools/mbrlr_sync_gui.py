"""MBRLR Local Sync - desktop GUI for validated CY/PY portal data refresh."""
from __future__ import annotations

import json
import queue
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from local_portal_sync import MONTH_LABELS, write_outputs
from reporting_settings import load_settings, save_settings, calendar_cutoff


ROOT = Path(__file__).resolve().parents[1]
PORTABLE_CY = ROOT.parent / "source-files" / "2026-2027"
DEFAULT_CY = PORTABLE_CY if PORTABLE_CY.is_dir() else Path(r"D:\PORTAL DATA\current year")
DEFAULT_PY = Path(r"C:\Users\HP\Downloads\PORTAL DATA PY")
DEFAULT_GITHUB = ROOT
PORT = 8767


class SyncApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MBRLR Local Sync")
        self.geometry("980x820")
        self.minsize(880, 700)
        self.configure(bg="#eef4fb")
        self.cy_files: list[Path] = []
        self.py_files: list[Path] = []
        self.events: queue.Queue = queue.Queue()
        self._calendar_month = datetime.now().strftime("%Y-%m")
        self._sync_running = False
        self._source_fingerprint = None
        self._pending_month_refresh = False
        self.settings = load_settings(ROOT)
        self._build_ui()
        self.after(150, self._drain_events)
        self.after(1200, self._check_initial_month_refresh)
        self.after(60000, self._check_month_rollover)
        self.after(3000, self._watch_source_folder)

    def _build_ui(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TFrame", background="#eef4fb")
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("Title.TLabel", background="#0a1628", foreground="#c9a84c", font=("Segoe UI", 18, "bold"))
        style.configure("Sub.TLabel", background="#0a1628", foreground="#b9cbe0", font=("Segoe UI", 10))
        style.configure("CardTitle.TLabel", background="#ffffff", foreground="#123a63", font=("Segoe UI", 12, "bold"))
        style.configure("TButton", font=("Segoe UI", 10, "bold"), padding=7)

        header = tk.Frame(self, bg="#0a1628", padx=20, pady=16)
        header.pack(fill="x")
        ttk.Label(header, text="MBRLR LOCAL SYNC", style="Title.TLabel").pack(anchor="w")
        ttk.Label(header, text="Validated desktop update for Current Year, optional Previous Year, portal calculations and all exports", style="Sub.TLabel").pack(anchor="w", pady=(3, 0))

        body = ttk.Frame(self, padding=14)
        body.pack(fill="both", expand=True)
        self.repo_var = tk.StringVar(value=str(ROOT))
        self.github_var = tk.StringVar(value=str(DEFAULT_GITHUB))
        self.cy_var = tk.StringVar(value=str(DEFAULT_CY))
        self.py_var = tk.StringVar(value=str(DEFAULT_PY))
        self.use_py = tk.BooleanVar(value=False)
        self.auto_open = tk.BooleanVar(value=True)
        self.fy_var = tk.StringVar(value=self.settings['financial_year'])
        self.follow_calendar = tk.BooleanVar(value=self.settings.get('follow_calendar', False))
        start_year = int(self.fy_var.get()[:4])
        self.month_choices = ["AUTO - detect from uploaded actuals"] + [f"{m} {start_year + (i > 8)}" for i, m in enumerate(MONTH_LABELS)]
        self.completed_choices = ["AUTO - month before running", "NONE - no completed month"] + self.month_choices[1:]
        self.running_month_var = tk.StringVar(value=self.month_choices[0])
        self.completed_month_var = tk.StringVar(value=self.completed_choices[0])
        if self.settings.get('running') is not None:
            self.running_month_var.set(self.month_choices[self.settings['running'] + 1])
        if self.settings.get('completed') is not None:
            self.completed_month_var.set(self.completed_choices[self.settings['completed'] + 2])
        year_row = ttk.Frame(body)
        year_row.pack(fill='x', pady=5)
        ttk.Label(year_row, text='Financial year').pack(side='left')
        year_box = ttk.Combobox(year_row, textvariable=self.fy_var, state='readonly', values=[f'{y}-{y+1}' for y in range(start_year-5, start_year+11)], width=14)
        year_box.pack(side='left', padx=8)
        year_box.bind('<<ComboboxSelected>>', self._change_year)
        ttk.Checkbutton(year_row, text='Follow calendar month (otherwise retain selected cutoff)', variable=self.follow_calendar).pack(side='left')

        self._path_card(body, "Portal and GitHub Desktop working folders", [
            ("Portal source", self.repo_var, lambda: self._browse_dir(self.repo_var)),
            ("GitHub Desktop folder", self.github_var, lambda: self._browse_dir(self.github_var)),
        ]).pack(fill="x", pady=(0, 10))

        month_card = ttk.Frame(body, style="Card.TFrame", padding=12)
        month_card.pack(fill="x", pady=(0, 10))
        month_card.columnconfigure(1, weight=1); month_card.columnconfigure(3, weight=1)
        ttk.Label(month_card, text="Reporting Month Control", style="CardTitle.TLabel").grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 7))
        ttk.Label(month_card, text="Completed through", background="#ffffff").grid(row=1, column=0, sticky="w", padx=(0, 7))
        self.completed_box = ttk.Combobox(month_card, textvariable=self.completed_month_var, values=self.completed_choices, state="readonly")
        self.completed_box.grid(row=1, column=1, sticky="ew", padx=(0, 14))
        ttk.Label(month_card, text="Current / running", background="#ffffff").grid(row=1, column=2, sticky="w", padx=(0, 7))
        self.running_box = ttk.Combobox(month_card, textvariable=self.running_month_var, values=self.month_choices, state="readonly")
        self.running_box.grid(row=1, column=3, sticky="ew")
        ttk.Label(month_card, text="Manual months must be consecutive; the cutoff refreshes portal calculations and every export.", background="#ffffff", foreground="#607080").grid(row=2, column=0, columnspan=4, sticky="w", pady=(7, 0))

        years = ttk.Frame(body)
        years.pack(fill="x")
        years.columnconfigure(0, weight=1)
        years.columnconfigure(1, weight=1)
        cy = self._year_card(years, "CURRENT YEAR (selected FY)", self.cy_var, self.cy_files, False)
        cy.grid(row=0, column=0, sticky="nsew", padx=(0, 5))
        py = self._year_card(years, "PREVIOUS YEAR (selected FY minus one)", self.py_var, self.py_files, True)
        py.grid(row=0, column=1, sticky="nsew", padx=(5, 0))

        controls = ttk.Frame(body, style="Card.TFrame", padding=12)
        controls.pack(fill="x", pady=10)
        ttk.Checkbutton(controls, text="Always open refreshed portal after successful sync", variable=self.auto_open, state="disabled").pack(side="left")
        self.sync_btn = ttk.Button(controls, text="SIMULATE, VALIDATE & SYNC", command=self.start_sync)
        self.sync_btn.pack(side="right")

        gates = ttk.Frame(body, style="Card.TFrame", padding=10)
        gates.pack(fill="x", pady=(0, 10))
        ttk.Label(gates, text="Mandatory Validation Gates", style="CardTitle.TLabel").pack(anchor="w", pady=(0, 6))
        gate_row = ttk.Frame(gates, style="Card.TFrame"); gate_row.pack(fill="x")
        self.gate_vars = {name: tk.StringVar(value=f"{name}: WAITING") for name in ("SOURCE", "CALCULATION", "PAGES", "EXPORTS")}
        for variable in self.gate_vars.values():
            tk.Label(gate_row, textvariable=variable, bg="#e8eef6", fg="#40546b", padx=10, pady=5, font=("Segoe UI", 9, "bold")).pack(side="left", expand=True, fill="x", padx=3)

        log_card = ttk.Frame(body, style="Card.TFrame", padding=10)
        log_card.pack(fill="both", expand=True)
        ttk.Label(log_card, text="Simulation and Sync Log", style="CardTitle.TLabel").pack(anchor="w", pady=(0, 6))
        self.log = tk.Text(log_card, height=13, bg="#071324", fg="#dcecff", insertbackground="white", font=("Consolas", 9), relief="flat", padx=10, pady=8)
        self.log.pack(fill="both", expand=True)
        self.status_var = tk.StringVar(value="Ready - no files changed")
        tk.Label(self, textvariable=self.status_var, anchor="w", bg="#1a3a6a", fg="white", padx=12, pady=7, font=("Segoe UI", 9, "bold")).pack(fill="x")

    def _path_card(self, parent, title, rows):
        card = ttk.Frame(parent, style="Card.TFrame", padding=12)
        ttk.Label(card, text=title, style="CardTitle.TLabel").grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 7))
        card.columnconfigure(1, weight=1)
        for index, (label, variable, command) in enumerate(rows, 1):
            ttk.Label(card, text=label, background="#ffffff").grid(row=index, column=0, sticky="w", padx=(0, 8), pady=3)
            ttk.Entry(card, textvariable=variable).grid(row=index, column=1, sticky="ew", pady=3)
            ttk.Button(card, text="Browse", command=command).grid(row=index, column=2, padx=(8, 0), pady=3)
        return card

    def _year_card(self, parent, title, variable, selected_files, previous):
        card = ttk.Frame(parent, style="Card.TFrame", padding=12)
        card.columnconfigure(0, weight=1)
        ttk.Label(card, text=title, style="CardTitle.TLabel").grid(row=0, column=0, columnspan=2, sticky="w")
        if previous:
            ttk.Checkbutton(card, text="Update PY comparison data", variable=self.use_py).grid(row=1, column=0, columnspan=2, sticky="w", pady=(5, 2))
        ttk.Entry(card, textvariable=variable).grid(row=2, column=0, sticky="ew", pady=5)
        ttk.Button(card, text="Folder", command=lambda: self._browse_dir(variable)).grid(row=2, column=1, padx=(6, 0))
        ttk.Button(card, text="Select individual files", command=lambda: self._select_files(selected_files, previous)).grid(row=3, column=0, columnspan=2, sticky="ew")
        note = "Required: 6 CY reports" if not previous else "Required when enabled: PU budget + PU month actual"
        ttk.Label(card, text=note, background="#ffffff", foreground="#607080").grid(row=4, column=0, columnspan=2, sticky="w", pady=(6, 0))
        return card

    def _browse_dir(self, variable):
        chosen = filedialog.askdirectory(initialdir=variable.get() or str(ROOT))
        if chosen:
            variable.set(chosen)

    def _select_files(self, target, previous):
        files = filedialog.askopenfilenames(title="Select XLS/XLSX reports", filetypes=[("Excel reports", "*.xls *.xlsx")])
        if files:
            target[:] = [Path(p) for p in files]
            if previous:
                self.use_py.set(True)
            self._append(f"Selected {len(target)} {'PY' if previous else 'CY'} individual file(s).")

    def _append(self, message):
        self.log.insert("end", message.rstrip() + "\n")
        self.log.see("end")

    def _change_year(self, event=None):
        year = int(self.fy_var.get()[:4])
        self.month_choices = ['AUTO - detect from uploaded actuals'] + [f'{m} {year + (i > 8)}' for i, m in enumerate(MONTH_LABELS)]
        self.completed_choices = ['AUTO - month before running', 'NONE - no completed month'] + self.month_choices[1:]
        self.running_box.configure(values=self.month_choices)
        self.completed_box.configure(values=self.completed_choices)
        self.running_month_var.set(self.month_choices[0])
        self.completed_month_var.set(self.completed_choices[0])
        self._append('FY changed: select matching CY and PY files. Existing data is not automatically relabelled.')

    def start_sync(self):
        if self._sync_running:
            return
        try:
            if self.follow_calendar.get():
                running, completed = calendar_cutoff(self.fy_var.get(), datetime.now())
                self.running_month_var.set(self.month_choices[running+1])
                self.completed_month_var.set(self.completed_choices[completed+2])
            running, completed = self._selected_month_cutoff()
            self._run_settings = {'financial_year': self.fy_var.get(), 'running': running, 'completed': completed, 'follow_calendar': self.follow_calendar.get()}
        except Exception as exc:
            messagebox.showerror('Reporting settings', str(exc))
            return
        self._sync_running = True
        self.sync_btn.configure(state="disabled")
        self.status_var.set("Simulation running - portal files are not mirrored until validation passes")
        self._append("\n--- MBRLR validated sync started ---")
        for name, variable in self.gate_vars.items():
            variable.set(f"{name}: RUNNING")
        threading.Thread(target=self._sync_worker, daemon=True).start()

    def _stage(self, files, fallback, stack):
        if not files:
            return Path(fallback)
        temp = tempfile.TemporaryDirectory(prefix="mbrlr-sync-")
        stack.append(temp)
        folder = Path(temp.name)
        for source in files:
            shutil.copy2(source, folder / source.name)
        return folder

    def _sync_worker(self):
        temps = []
        backup_dir = None
        root = None
        try:
            root = Path(self.repo_var.get()).resolve()
            github = Path(self.github_var.get()).resolve() if self.github_var.get().strip() else None
            cy_source = self._stage(self.cy_files, self.cy_var.get(), temps)
            py_source = self._stage(self.py_files, self.py_var.get(), temps) if self.use_py.get() else None
            self.events.put(("log", f"CY source: {cy_source}"))
            self.events.put(("log", f"PY source: {py_source if py_source else 'unchanged'}"))
            self.events.put(("log", "Detecting report roles from worksheet columns..."))
            backup_dir = self._backup_generated_files(root, temps)
            running_idx, completed_idx = self._run_settings['running'], self._run_settings['completed']
            self.events.put(("log", f"Month cutoff: completed={self.completed_month_var.get()}, running={self.running_month_var.get()}"))
            summary = write_outputs(root, cy_source, github, py_source, running_idx, completed_idx, self._run_settings['financial_year'])
            manifest = json.loads((root / "data/mb-budget-sync/sync-manifest.json").read_text(encoding="utf-8"))
            validation = manifest.get("calculationValidation", {})
            if not validation.get("ok"):
                raise RuntimeError("Generated calculation validation did not pass")
            unit_validation = manifest.get("unitValidation", {})
            if not unit_validation.get("ok") or unit_validation.get("unit") != "Rs '000":
                raise RuntimeError("Rs '000 unit validation did not pass")
            portal_validation = manifest.get("portalValidation", {})
            export_validation = manifest.get("exportValidation", {})
            if not portal_validation.get("ok") or portal_validation.get("viewCount") != 16:
                raise RuntimeError("All portal pages did not pass the fixed refresh contract")
            if not export_validation.get("ok") or export_validation.get("minimumFontPt") != 10:
                raise RuntimeError("Excel/PDF/PowerPoint export contract did not pass")
            smoke_test = manifest.get("smokeTest", {})
            if not smoke_test.get("ok") or smoke_test.get("sourceFileCount") != 6:
                raise RuntimeError("Mandatory end-to-end smoke test did not pass")
            history = manifest.get("history", {})
            if not history.get("latestSnapshotId") or not history.get("indexPath"):
                raise RuntimeError("History snapshot archive was not updated")
            self.events.put(("gates", {"SOURCE": True, "CALCULATION": True, "PAGES": True, "EXPORTS": True}))
            self.events.put(("log", json.dumps(summary, indent=2)))
            self.events.put(("log", f"PASS: calculation simulation; PU mismatches {validation.get('puMonthMismatches', 0)}"))
            self.events.put(("log", f"PASS: amount unit gate; all datasets normalized as {unit_validation.get('unit')} before page/export refresh"))
            self.events.put(("log", f"PASS: month sensing selected latest uploaded actual {summary.get('latestMonth', 'none')} using system month {datetime.now().strftime('%b %Y').upper()}"))
            self.events.put(("log", f"PASS: export sources refreshed under asset version {manifest.get('assetVersion')}"))
            self.events.put(("log", f"PASS: {portal_validation.get('viewCount')} portal pages refreshed and validated"))
            self.events.put(("log", f"PASS: history snapshot archived as {history.get('latestSnapshotId')} ({history.get('snapshotCount', 0)} snapshots indexed)"))
            self.events.put(("log", f"PASS: XLSX/PDF/PPTX mock contract; minimum font {export_validation.get('minimumFontPt')} pt; freshness guards {export_validation.get('freshnessGuards')}"))
            self.events.put(("log", "PASS: persistent end-to-end smoke-test report written"))
            portal_root = github if github and github.exists() else root
            self._ensure_server(portal_root)
            url = f"http://127.0.0.1:{PORT}/index.html?fresh={manifest.get('assetVersion', 'latest')}"
            self._validate_live_portal(url, manifest)
            save_settings(ROOT, self._run_settings)
            self.events.put(("log", "PASS: every portal tab, Data Export Centre route, refreshed data payload, and Excel/PDF/PPT master export is available in the fresh live build"))
            webbrowser.open(url)
            self.events.put(("done", f"Sync complete - {manifest.get('sourceRevision')} - {url}"))
        except Exception as exc:
            if root is not None and backup_dir is not None:
                self._restore_generated_files(root, backup_dir)
                self.events.put(("log", "ROLLBACK: restored the last-known-good portal files"))
            self.events.put(("gates", {"SOURCE": False, "CALCULATION": False, "PAGES": False, "EXPORTS": False}))
            self.events.put(("error", str(exc)))
        finally:
            for temp in temps:
                temp.cleanup()

    def _ensure_server(self, portal_root):
        with socket.socket() as sock:
            sock.settimeout(.4)
            if sock.connect_ex(("127.0.0.1", PORT)) == 0:
                return
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=portal_root, creationflags=flags, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _generated_paths(self):
        return [
            Path("index.html"), Path("assets/js/app.js"), Path("assets/js/detail-data.js"),
            Path("assets/js/demand-smh-data.js"), Path("data/mb-budget-sync/sync-manifest.json"),
            Path("data/mb-budget-sync/sync-log.json"), Path("data/mb-budget-sync/smoke-test.json"),
            Path("data/mb-budget-sync/audit-history.json"),
            Path("data/mb-budget-sync/history/history-index.json"),
        ]

    def _backup_generated_files(self, root, temps):
        temp = tempfile.TemporaryDirectory(prefix="mbrlr-last-good-")
        temps.append(temp)
        backup = Path(temp.name)
        for rel in self._generated_paths():
            source = root / rel
            if source.exists():
                target = backup / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        self.events.put(("log", "BACKUP: last-known-good generated files secured for this run"))
        return backup

    def _restore_generated_files(self, root, backup):
        for rel in self._generated_paths():
            source = backup / rel
            if source.exists():
                target = root / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)

    def _folder_fingerprint(self):
        folder = Path(self.cy_var.get())
        if not folder.is_dir() or self.cy_files:
            return None
        return tuple(sorted((p.name.lower(), p.stat().st_size, p.stat().st_mtime_ns) for p in folder.iterdir() if p.is_file() and p.suffix.lower() in {".xls", ".xlsx"}))

    def _watch_source_folder(self):
        try:
            fingerprint = self._folder_fingerprint()
            if self._source_fingerprint is None:
                self._source_fingerprint = fingerprint
            elif fingerprint and fingerprint != self._source_fingerprint:
                self._source_fingerprint = fingerprint
                self._append("SOURCE CHANGE DETECTED: Current Year workbook folder was updated.")
                if not self._sync_running and messagebox.askyesno("MBRLR Local Sync", "New or changed Current Year files were detected.\n\nRun the full validated sync now?"):
                    self.start_sync()
        except Exception as exc:
            self._append(f"Folder watcher warning: {exc}")
        self.after(30000, self._watch_source_folder)

    def _check_initial_month_refresh(self):
        """Automatically catch up when the GUI is first opened in a new month."""
        try:
            root = Path(self.repo_var.get()).resolve()
            manifest_path = root / "data/mb-budget-sync/sync-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
            last_month = str(manifest.get("generatedAt", ""))[:7]
            if last_month and last_month != self._calendar_month:
                self._append(f"MONTH CHANGE SENSED: last calculation {last_month}; system month {self._calendar_month}. Auto-refreshing all views and exports.")
                self._request_month_refresh()
        except Exception as exc:
            self._append(f"Month-sensing startup check warning: {exc}")

    def _check_month_rollover(self):
        """While the GUI remains open, rerun everything at a calendar-month change."""
        current_month = datetime.now().strftime("%Y-%m")
        if current_month != self._calendar_month:
            previous_month = self._calendar_month
            self._calendar_month = current_month
            self._append(f"MONTH CHANGE SENSED: {previous_month} to {current_month}. Auto-refreshing calculations, portal views, and exports.")
            self._request_month_refresh()
        self.after(60000, self._check_month_rollover)

    def _request_month_refresh(self):
        if self._sync_running:
            self._pending_month_refresh = True
        else:
            self.start_sync()

    def _validate_live_portal(self, url, manifest):
        """Fail the sync unless the live cache-fresh portal exposes every view and export."""
        asset_version = manifest.get("assetVersion", "")
        month_status = manifest.get("monthStatus", {})
        last_error = None
        for _ in range(20):
            try:
                with urllib.request.urlopen(url, timeout=3) as response:
                    html = response.read().decode("utf-8", errors="replace")
                app_url = f"http://127.0.0.1:{PORT}/assets/js/app.js?v={asset_version}"
                with urllib.request.urlopen(app_url, timeout=3) as response:
                    app_js = response.read().decode("utf-8", errors="replace")
                display_export_url = f"http://127.0.0.1:{PORT}/assets/js/display-export.js?v={asset_version}"
                with urllib.request.urlopen(display_export_url, timeout=3) as response:
                    display_export_js = response.read().decode("utf-8", errors="replace")
                required_views = (
                    "tab-summary", "tab-monthwise", "tab-pumaster", "tab-excessshortfall", "tab-trend",
                    "tab-aitrend", "tab-bpanalysis", "tab-budgetcontrol",
                    "tab-smhdetail", "tab-demandsmh", "tab-remarks",
                    "tab-backup", "tab-admin", "tab-liability", "tab-dataexport", "tab-historycompare",
                )
                missing_views = [view for view in required_views if f'id="{view}"' not in html]
                required_exports = ("downloadExcel", "downloadPDFReport", "downloadPowerPoint", "downloadHistoryCompareExport")
                missing_exports = [name for name in required_exports if name not in app_js]
                required_export_rules = {
                    "Excel landscape": "orientation:'landscape'",
                    "Excel fit-to-page": "fitToWidth:1",
                    "PDF A4 landscape": "new jsPDF({orientation:'landscape', unit:'pt', format:'a4'})",
                    "PDF minimum 10 pt": "styles:{fontSize:10",
                    "PowerPoint 16:9": '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>',
                    "PowerPoint minimum 10 pt": "Math.max(1000,size)",
                    "Excel freshness guard": "prepareFreshExport('Excel')",
                    "PDF freshness guard": "prepareFreshExport('PDF')",
                    "PowerPoint freshness guard": "prepareFreshExport('PowerPoint')",
                }
                missing_export_rules = [label for label, token in required_export_rules.items() if token not in app_js]
                data_export_rules = {
                    "Combined Excel route": "DisplayExport.run('Excel','all',{tableOnly:true})",
                    "Combined PDF route": "DisplayExport.run('PDF','all',{tableOnly:true})",
                    "Combined PowerPoint route": "DisplayExport.run('PPT','all',{tableOnly:true})",
                    "Page-wise table-only matrix": "{tableOnly:true}",
                    "Fresh table capture": "prepareFreshExport(format)",
                    "Refreshed table filenames": "'_page_data_'",
                }
                missing_data_export_rules = [
                    label for label, token in data_export_rules.items()
                    if token not in (html + display_export_js)
                ]
                master_refresh_rules = {
                    "Master Excel fresh-data guard": "prepareFreshExport('Excel')",
                    "Master PDF fresh-data guard": "prepareFreshExport('PDF')",
                    "Master PowerPoint fresh-data guard": "prepareFreshExport('PowerPoint')",
                    "Master data fingerprint": "exportDataFingerprint()",
                    "Master calculation validation": "portalValidationChecks()",
                }
                missing_master_refresh_rules = [label for label, token in master_refresh_rules.items() if token not in app_js]
                if asset_version and asset_version not in app_js:
                    raise RuntimeError("Live portal is serving a stale application asset")
                expected_month_idx = month_status.get("reportingMonthIndex")
                if expected_month_idx is not None and f"let _reportingCurrentMonthIdx = {expected_month_idx};" not in app_js:
                    raise RuntimeError("Live portal reporting month does not match the uploaded month")
                if missing_views:
                    raise RuntimeError("Missing portal views: " + ", ".join(missing_views))
                if missing_exports:
                    raise RuntimeError("Missing export functions: " + ", ".join(missing_exports))
                if missing_export_rules:
                    raise RuntimeError("Missing fixed export rules: " + ", ".join(missing_export_rules))
                if missing_data_export_rules:
                    raise RuntimeError("Data Export Centre refresh contract failed: " + ", ".join(missing_data_export_rules))
                if missing_master_refresh_rules:
                    raise RuntimeError("Master download refresh contract failed: " + ", ".join(missing_master_refresh_rules))
                sync_manifest_url = f"http://127.0.0.1:{PORT}/data/mb-budget-sync/sync-manifest.json?v={asset_version}"
                with urllib.request.urlopen(sync_manifest_url, timeout=3) as response:
                    served_manifest = json.loads(response.read().decode("utf-8", errors="replace"))
                if served_manifest.get("sourceRevision") != manifest.get("sourceRevision"):
                    raise RuntimeError("Served sync manifest does not match the refreshed source revision")
                reports_url = f"http://127.0.0.1:{PORT}/data/mb-budget-sync/processed/reports-data.json?v={asset_version}"
                with urllib.request.urlopen(reports_url, timeout=3) as response:
                    served_reports = json.loads(response.read().decode("utf-8", errors="replace"))
                if served_reports.get("summary", {}).get("generatedAt") != manifest.get("generatedAt"):
                    raise RuntimeError("Data Export Centre report payload is stale")
                payload_url = f"http://127.0.0.1:{PORT}/data/mb-budget-sync/processed/current_payload.js?v={asset_version}"
                with urllib.request.urlopen(payload_url, timeout=3) as response:
                    served_payload = response.read().decode("utf-8", errors="replace")
                if manifest.get("generatedAt", "") not in served_payload:
                    raise RuntimeError("Master download current payload is stale")
                history_url = f"http://127.0.0.1:{PORT}/data/mb-budget-sync/history/history-index.json?v={asset_version}"
                with urllib.request.urlopen(history_url, timeout=3) as response:
                    history_index = json.loads(response.read().decode("utf-8", errors="replace"))
                if not history_index.get("latestSnapshotId") or len(history_index.get("snapshots", [])) < 1:
                    raise RuntimeError("Live portal history snapshot index is missing or empty")
                if 'type="file"' in html:
                    raise RuntimeError("Browser upload control unexpectedly returned")
                return
            except Exception as exc:
                last_error = exc
                time.sleep(.25)
        raise RuntimeError(f"Live portal validation failed: {last_error}")

    def _selected_month_cutoff(self):
        running_text, completed_text = self.running_month_var.get(), self.completed_month_var.get()
        running_idx = None if running_text.startswith("AUTO") else self.month_choices[1:].index(running_text)
        if completed_text.startswith("AUTO"):
            completed_idx = None if running_idx is None else running_idx - 1
        elif completed_text.startswith("NONE"):
            completed_idx = -1
        else:
            completed_idx = self.month_choices[1:].index(completed_text)
        if running_idx is None and completed_idx is not None:
            running_idx = completed_idx + 1
        if running_idx is not None and completed_idx != running_idx - 1:
            raise RuntimeError("Completed Through must immediately precede Current / Running Month")
        return running_idx, completed_idx

    def _drain_events(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self._append(value)
                elif kind == "done":
                    self._append("SUCCESS: " + value)
                    self.status_var.set(value)
                    self.sync_btn.configure(state="normal")
                    self._sync_running = False
                    messagebox.showinfo("MBRLR Local Sync", "Simulation, validation and sync completed successfully.\n\n" + value)
                elif kind == "gates":
                    for name, passed in value.items():
                        self.gate_vars[name].set(f"{name}: {'PASS' if passed else 'FAILED'}")
                elif kind == "error":
                    self._append("FAILED: " + value)
                    self.status_var.set("Sync failed - portal mirror was not intentionally advanced")
                    self.sync_btn.configure(state="normal")
                    self._sync_running = False
                    messagebox.showerror("MBRLR Local Sync", value)
        except queue.Empty:
            pass
        if self._pending_month_refresh and not self._sync_running:
            self._pending_month_refresh = False
            self.start_sync()
        self.after(150, self._drain_events)


if __name__ == "__main__":
    SyncApp().mainloop()
