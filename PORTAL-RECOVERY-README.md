# NR Zone local recovery

The authoritative data sources are the twelve reports per year listed in tools/nr-source-config.json and docs/ZONEMASTER.xls. Keep a separate backup of the original spreadsheets before replacing them.

To rebuild: restore the source folders for FY 2026-2027 and FY 2025-2026, then run SYNC-NR-ZONE-LOCAL.bat. Both year payloads are validated before publication. This workflow stays inside NROWE and does not mirror, commit or push to another repository.

Generated NR payload recovery copies are stored in data/mb-budget-sync/nr-history. Each run records the manifest, source hashes, before-payloads and published payloads for all Zone/AU scopes. To recover a prior generated view, stop edits, keep a copy of the current files, and restore the chosen snapshot's zone-au-data.js and zone-au-py-data.js into assets/js. Reload the local portal and run the NR portal simulation. A generated-data snapshot does not contain the original workbooks and must not be treated as an original-source backup.

The original single-AU source copies, old repository sync histories and obsolete test reports were retired after local recovery copies were made outside this repository. The two older PY PU files were verified identical to AU 0307 records in the all-AU reports. Legacy launchers redirect to NR local sync; legacy single-AU Python writes are disabled.
