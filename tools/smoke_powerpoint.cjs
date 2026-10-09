// Exercise the portal's actual PPTX generator without changing browser access.
// Usage: node tools/smoke_powerpoint.cjs OUTPUT.pptx
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/mb-budget-sync/sync-manifest.json')));
const ctx = vm.createContext({Blob, TextEncoder, Uint8Array, DataView, Date,
  document: {getElementById: () => null}, _crcTable: null});
for (const name of ['BUDGET','MONTH','BUDGET_PY','MONTH_PY','HQ_EXCESS_SHORTFALL_PUS','PU_META','FY_MONTHS','FY_MONTH_LABELS','SKIPPED_DISPLAY_PUS','IMPORTANT_PUS','_reportingCurrentMonthIdx','_latestActualMonthIdx']) {
  const match = app.match(new RegExp(`^(?:const|let) ${name} = ([\\s\\S]*?);`, 'm'));
  assert.ok(match, `Missing ${name}`);
  vm.runInContext(`var ${name} = ${match[1]};`, ctx);
}
for (const name of ['getBPModeStatus','buildExcessShortfallRows','signedCr','getCurrentFYMonth','getMonthStatus','isRGActive','getBudget','compute',
  'normPUCode','isSkippedDisplayPU','isImportantPU','puFocusMode','passesPUFocus','isActiveDisplayPU','activePUMeta',
  'isBudgetNoExpense','reportRowsForActivePUs','textCr','indianDateTime',
  'crc32','dosDateTime','u16','u32','concatUint8','createZipBlob','pptEscape','pptTextShape','pptSlideXml','buildPowerPointBlob']) {
  const match = app.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm'));
  assert.ok(match, `Missing function ${name}`);
  vm.runInContext(match[0], ctx);
}
const rows = ctx.reportRowsForActivePUs();
const months = ctx.FY_MONTHS.slice(0, ctx._latestActualMonthIdx + 1);
const monthly = months.map(month => rows.reduce((s,r) => s+(ctx.MONTH[r.pu.code]?.[month]||0), 0));
const totals = rows.reduce((t,r) => ({budget:t.budget+r.budget,actual:t.actual+r.actual,balance:t.balance+r.balance}), {budget:0,actual:0,balance:0});
assert.ok(Math.abs(monthly.reduce((a,b)=>a+b,0)-totals.actual)<0.01, 'Monthly actuals must reconcile');
assert.equal(manifest.calculationValidation.ok, true);
const audit = {generatedAt:new Date().toISOString(), latestMonth:manifest.monthStatus.latestUploadedMonth,
  id:manifest.assetVersion, checks:[
    {state:'ok',title:'Source reconciliation',detail:'Six current-year reports parsed and validated.'},
    {state:'ok',title:'Month-wise actuals',detail:'Displayed monthly amounts reconcile to total expenditure.'},
    {state:'ok',title:'Reporting cutoff',detail:`Completed ${manifest.monthStatus.completedThrough}; running ${manifest.monthStatus.reportingCurrentMonth}.`}
  ]};
(async () => {
  const output = path.resolve(process.argv[2] || path.join(root, '.export-validation/latest.pptx'));
  fs.mkdirSync(path.dirname(output), {recursive:true});
  fs.writeFileSync(output, Buffer.from(await ctx.buildPowerPointBlob(audit).arrayBuffer()));
  fs.writeFileSync(output+'.json', JSON.stringify({audit,rows:rows.length,months,monthly,totals},null,2));
  console.log(JSON.stringify({output,rows:rows.length,months,monthly,totals},null,2));
})().catch(e => {console.error(e);process.exitCode=1;});

