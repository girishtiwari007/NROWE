const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const vendor=name=>path.join(root,'assets/vendor',name);
const {jsPDF}=require(vendor('jspdf.umd.min.js'));
const plugin={exports:{}};
vm.runInNewContext(fs.readFileSync(vendor('jspdf.plugin.autotable.min.js'),'utf8'),{module:plugin,exports:plugin.exports,require:n=>({jsPDF}),console});
const matrix=require('../assets/js/smh-matrix-export.js');
assert.deepEqual(matrix.varianceStyle(1).textColor,[160,20,20]);
assert.deepEqual(matrix.varianceStyle(-1).textColor,[20,100,45]);
assert.deepEqual(matrix.varianceStyle(0).textColor,[60,60,60]);
assert.deepEqual(matrix.varianceStyle(null).textColor,[60,60,60]);
const ctx={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/js/detail-data.js'),'utf8'),ctx);
const rows=ctx.window.DETAIL_SMH_DATA.rows;
const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/mb-budget-sync/sync-manifest.json')));
const months=['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'].slice(0,manifest.monthStatus.completedMonthCount);
const sums=kind=>Object.values(matrix.build(rows,months,kind).groups.at(-1).cells).reduce((s,c)=>[s[0]+c.act,s[1]+c.bp],[0,0]);
const pu=sums('pu'),dept=sums('dept');
assert.ok(Math.abs(pu[0]-dept[0])<1e-6 && Math.abs(pu[1]-dept[1])<1e-6);
assert.ok(Math.abs(pu[0]-rows.reduce((s,r)=>s+months.reduce((v,m)=>v+r.months[m],0),0))<1e-6);
const out=path.resolve(process.argv[2]||path.join(root,'output/pdf'));fs.mkdirSync(out,{recursive:true});
for(const unit of ['dual']) {
 const fonts={normal:fs.readFileSync(path.join(root,'assets/fonts/times.ttf')).toString('base64'),bold:fs.readFileSync(path.join(root,'assets/fonts/timesbd.ttf')).toString('base64')};
 const doc=matrix.generate(jsPDF,rows,months,{fy:manifest.financialYear,through:manifest.monthStatus.completedThrough,revision:manifest.sourceRevision,generated:new Date().toISOString()},unit,fonts);
 fs.writeFileSync(path.join(out,`MBRLR_SMH_${unit}.pdf`),Buffer.from(doc.output('arraybuffer')));
 console.log(unit,doc.getNumberOfPages(),'pages');
}
console.log('PASS: PU and department totals reconcile',pu);
