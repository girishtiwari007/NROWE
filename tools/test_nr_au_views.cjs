const assert=require('assert'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.NR_PLAYWRIGHT||'C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=process.env.NR_TEST_OUTPUT||path.resolve(__dirname,'../data/mb-budget-sync/nr-test-output/au-views');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().startsWith('AU view:'))errors.push(m.text());});
 await page.goto(process.env.NR_PORTAL_URL||'http://127.0.0.1:8874/',{waitUntil:'networkidle'});
 await page.evaluate(()=>{applyNRScopes(['0303','0307']);NR_FILTERS.restore({scopes:['0303','0307'],mode:'specific',pus:['25','28'],pages:{}});renderAll();NR_SCOPE_VIEW.set('separate');});
 async function ready(tab){await page.evaluate(tab=>switchTab(tab),tab);await page.waitForTimeout(500);await page.evaluate(tab=>NR_SCOPE_VIEW.ensure(tab),tab);await page.waitForTimeout(80);}
 await ready('liability');
 const controls=await page.evaluate(()=>{
  const report=DisplayExport.capture('liability',{tableOnly:true}),main=report.tables.find(t=>t.headers[1]==='PU'),comparison=report.tables.find(t=>t.headers.includes('PY matched actual'));
  return {main,comparison,source:['0303','0307'].flatMap(au=>['25','28'].map(pu=>{const s=NR_ZONE_DATA.scopes[au],p=NR_ZONE_PY_DATA.scopes[au],months=['apr','may','jun','jul','aug','sep','oct'];return {label:s.label,pu,budget:Number(s.budget[pu]?.rg)||Number(s.budget[pu]?.bg_isl)||0,actual:months.reduce((n,m)=>n+s.month[pu][m],0)/10000,prior:months.reduce((n,m)=>n+p.month[pu][m],0)/10000};}))};
 });assert(controls.main);assert.equal(controls.main.headers[0],'Division / AU name');
 const number=s=>Number(String(s).replace(/,/g,'')),budgetIndex=controls.main.headers.findIndex(h=>/^Budget/.test(h));
 for(const r of controls.source){const row=controls.main.rows.find(row=>row[0]===r.label&&row[1]===r.pu);assert(row,r.label+' '+r.pu);assert.equal(number(row[budgetIndex]),r.budget);const comparison=controls.comparison.rows.find(row=>row[0]===r.label&&row[2]===r.pu);assert(comparison);assert(Math.abs(number(comparison[7])-r.actual)<.006);assert(Math.abs(number(comparison[6])-r.prior)<.006);}
 console.log('PASS exact per-AU PU budgets, separate CY/PY actuals and AU-name first column');
 await page.screenshot({path:path.join(output,'separate-main.png')});
 for(const mode of ['combined','separate','combined','separate']){await page.selectOption('.filter-main .nr-au-view-select',mode);await page.waitForTimeout(400);const tables=await page.evaluate(()=>DisplayExport.capture('liability',{tableOnly:true}).tables),main=tables.find(t=>t.headers[1]==='PU');assert(main);assert.equal(main.rows.filter(r=>['25','28'].includes(r[1])).length,mode==='separate'?4:2);assert.equal(main.headers.filter(h=>h==='Division / AU name').length,1);}
 await page.evaluate(()=>applyNRScope('0303'));await page.waitForTimeout(400);const one=await page.evaluate(()=>DisplayExport.capture('liability',{tableOnly:true}).tables.find(t=>t.headers[1]==='PU'));assert.equal(one.headers.filter(h=>h==='Division / AU name').length,1);assert.equal(one.rows.filter(r=>['25','28'].includes(r[1])).length,2);
 await page.evaluate(()=>applyNRScopes(['0303','0307']));await page.waitForTimeout(400);
 const tabs=['summary','liability','monthwise','pumaster','smhdetail','demandsmh','bpanalysis','budgetcontrol','excessshortfall','trend','aitrend','historycompare','zonalfr'];
 for(const tab of tabs){await ready(tab);if(tab==='zonalfr'){await page.evaluate(()=>{selectFRPage('review');document.getElementById('frReviewView').value='selected';renderZonalFR();});await page.waitForTimeout(400);await page.evaluate(()=>NR_SCOPE_VIEW.ensure('zonalfr'));}
  const check=await page.evaluate(tab=>{const host=document.getElementById('tab-'+tab),out=host.querySelector('.nr-au-output'),report=DisplayExport.capture(tab,{tableOnly:true});return {out:!!out,labels:out?.innerText,headers:report.tables.map(t=>t.headers[0]),scopes:nrSelectedScopeCodes(),budgets:BUDGET['25'].bg_isl};},tab);
  assert(check.out,tab);assert(check.labels.includes('DELHI DIVISION — 0303'),tab);assert(check.labels.includes('MORADABAD DIVISION — 0307'),tab);assert(check.headers.every(h=>h==='Division / AU name'),tab+': '+check.headers.join(','));assert.deepEqual(check.scopes,['0303','0307']);console.log('PASS separate',tab);
 }
 await ready('liability');await page.evaluate(()=>window.confirmProtectedExport=()=>true);
 for(const mode of ['separate','combined']){await page.evaluate(mode=>NR_SCOPE_VIEW.set(mode),mode);await page.waitForTimeout(350);for(const format of ['Excel','PDF','PPT']){const wait=page.waitForEvent('download',{timeout:60000});await page.evaluate(({format})=>DisplayExport.run(format,'liability',{tableOnly:true}),{format});const d=await wait;await d.saveAs(path.join(output,mode+'-'+d.suggestedFilename()));assert(!await d.failure());}}
 await page.evaluate(()=>NR_SCOPE_VIEW.set('separate'));await page.waitForTimeout(350);await page.setViewportSize({width:390,height:900});await page.waitForTimeout(150);assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));await page.screenshot({path:path.join(output,'separate-mobile.png')});
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS 13 separate report pages, repeated mode changes, single-AU transition, 6 real exports and mobile');
})().catch(e=>{console.error(e);process.exit(1)});
