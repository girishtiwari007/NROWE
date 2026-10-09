# Sync Contract

The portal should not depend on whether data comes from manual upload, local GUI, Python sync, API sync, or future database sync.

## Future standard live outputs

```text
data/live/reports-data.json
data/live/current-payload.js
data/live/sync-manifest.json
```

Current implementation may use equivalent files. Future work should map to this contract without changing validated portal results.

## Every successful sync should

1. detect source files
2. validate required files
3. parse raw data
4. apply finance rules
5. calculate report data
6. run reconciliation checks
7. create snapshot archive
8. refresh live portal data
9. regenerate/validate exports where required
10. record sync manifest

## Snapshot archive

```text
data/mb-budget-sync/history/YYYY-MM-DD_HHMMSS_revision/
```

Recommended snapshot contents:

- source file names
- source file hashes
- parsed payload
- report data
- sync manifest
- validation result
- AI insight summary
- export status where available

## Minimum manifest shape

```json
{
  "syncId": "",
  "generatedAt": "",
  "financialYear": "",
  "completedThrough": "",
  "runningMonth": "",
  "sourceRevision": "",
  "sourceFiles": [],
  "fileHashes": {},
  "validationStatus": "",
  "validationNotes": [],
  "snapshotPath": ""
}
```
