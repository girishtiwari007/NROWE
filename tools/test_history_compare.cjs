const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'data', 'mb-budget-sync', 'history', 'history-index.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function close(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.01;
}

if (!fs.existsSync(indexPath)) {
  throw new Error('History index missing: data/mb-budget-sync/history/history-index.json');
}

const index = readJson(indexPath);
if (!index.ok || !Array.isArray(index.snapshots) || index.snapshots.length < 2) {
  throw new Error('History index must contain at least two snapshots for comparison smoke test');
}

const fromItem = index.snapshots[0];
const toItem = index.snapshots.find(item => item.id === index.latestSnapshotId) || index.snapshots[index.snapshots.length - 1];
const pair = [fromItem, toItem];
const snapshots = pair.map(item => {
  const snapshotPath = path.join(root, item.snapshotPath.replace(/\//g, path.sep));
  if (!fs.existsSync(snapshotPath)) throw new Error(`Snapshot file missing: ${item.snapshotPath}`);
  const snap = readJson(snapshotPath);
  if (!Array.isArray(snap.puRows) || !snap.puRows.length) throw new Error(`Snapshot has no PU rows: ${item.id}`);
  return snap;
});

const [fromSnap, toSnap] = snapshots;
const fromMap = new Map(fromSnap.puRows.map(row => [String(row.pu), row]));
const toMap = new Map(toSnap.puRows.map(row => [String(row.pu), row]));
const codes = new Set([...fromMap.keys(), ...toMap.keys()]);
const rows = [...codes].map(code => {
  const from = fromMap.get(code) || {};
  const to = toMap.get(code) || {};
  return {
    code,
    budgetChange: Number(to.budget || 0) - Number(from.budget || 0),
    actualChange: Number(to.actual || 0) - Number(from.actual || 0),
    balanceChange: Number(to.balance || 0) - Number(from.balance || 0),
  };
});

const totals = rows.reduce((acc, row) => {
  acc.budget += row.budgetChange;
  acc.actual += row.actualChange;
  acc.balance += row.balanceChange;
  return acc;
}, {budget: 0, actual: 0, balance: 0});

const fromTotals = fromSnap.totals || {};
const toTotals = toSnap.totals || {};
if (!close(totals.budget, Number(toTotals.budget || 0) - Number(fromTotals.budget || 0))) {
  throw new Error('Budget change total does not reconcile with snapshot totals');
}
if (!close(totals.actual, Number(toTotals.actual || 0) - Number(fromTotals.actual || 0))) {
  throw new Error('Actual change total does not reconcile with snapshot totals');
}
if (!close(totals.balance, Number(toTotals.balance || 0) - Number(fromTotals.balance || 0))) {
  throw new Error('Balance change total does not reconcile with snapshot totals');
}

const app = fs.readFileSync(path.join(root, 'assets', 'js', 'app.js'), 'utf8');
['function renderHistoryCompare', 'function downloadHistoryCompareExport', 'history-index.json'].forEach(token => {
  if (!app.includes(token)) throw new Error(`History Compare app contract missing: ${token}`);
});

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
['id="tab-historycompare"', 'History Compare exports', 'historyFromSync', 'historyExportFrom'].forEach(token => {
  if (!html.includes(token)) throw new Error(`History Compare HTML contract missing: ${token}`);
});

console.log(JSON.stringify({
  ok: true,
  snapshotsCompared: pair.map(item => item.id),
  rows: rows.length,
  totals,
}, null, 2));
