// Headless generator test using real source rows. Does not exercise browser navigation.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),api=require('../assets/js/display-export.js');
const ExcelJS=require('../assets/vendor/exceljs.min.js'),{jsPDF}=require('../assets/vendor/jspdf.umd.min.js');
const os=require('os');
const bundledModules=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules');
const PptxGenJS=require(path.join(bundledModules,'pptxgenjs'));
const plug={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/vendor/jspdf.plugin.autotable.min.js'),'utf8'),{module:plug,exports:plug.exports,require:()=>({jsPDF}),console});
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/js/detail-data.js'),'utf8'),context);
const data=JSON.parse(JSON.stringify(context.window.DETAIL_SMH_DATA));
const rows=data.rows.slice(0,30).map(r=>[r.puCode,r.puName,r.budget,...data.monthKeys.map(m=>r.months[m])]);
const table={title:'PU expenditure detail',headers:['PU Code','Description','Effective Budget',...data.monthLabels],rows};
const report={id:'smhdetail',title:'Department Expenditure Review',tables:[table],charts:[{title:'Monthly actual expenditure (Rs thousands)',type:'bar',series:[{name:'Actual',labels:data.monthLabels,values:data.monthKeys.map(m=>data.totals.months[m])}]}],notes:['Amounts are in Rs thousands. Actual postings may include adjustments.']};
assert.equal(api.typed('01',0,'PU Code'),'01');assert.equal(api.typed('1,234.50',2,'Budget'),1234.5);
const parts=api.bands(table);assert.equal(parts.reduce((n,p)=>n+p.headers.length-2,0),table.headers.length-2);
for(const p of parts)assert.equal(p.rows.length,rows.length);
const meta={period:'Department Expenditure Review | 23 Sept 2026',basis:'Completed through AUG 2026; running month SEP 2026',filters:'PU Type: Staff | Search: salary',sort:'Effective Budget descending',generated:'23 Sept 2026, 10:00 pm',source:'Source test-audit'};
const fonts={normal:fs.readFileSync(path.join(root,'assets/fonts/times.ttf')).toString('base64'),bold:fs.readFileSync(path.join(root,'assets/fonts/timesbd.ttf')).toString('base64')};
(async()=>{
 const dir=path.join(root,'.export-validation/display');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'display.xlsx'),Buffer.from(await api.excel([report],meta,ExcelJS)));
 fs.writeFileSync(path.join(dir,'display.pdf'),Buffer.from((await api.pdf([report],meta,jsPDF,fonts)).output('arraybuffer')));
 const deck=await api.ppt([report],meta,PptxGenJS);await deck.writeFile({fileName:path.join(dir,'display.pptx')});
 const tableDeck=await api.ppt([{...report,charts:[],notes:[]}],meta,PptxGenJS,{tableOnly:true});
 assert.ok(tableDeck._slides.length>0&&tableDeck._slides.length<deck._slides.length,'table-only PPT must contain formatted table slides without portal summary content');
 console.log('PASS: typed data, wide-table column coverage, and three generated editable/report formats',dir);
})().catch(e=>{console.error(e);process.exitCode=1;});
