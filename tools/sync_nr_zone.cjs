// Build compatible portal payloads from the explicitly selected local reports.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=process.argv[2]||path.resolve(__dirname,'..');
const out=process.argv[3]||root;
const X=require(path.join(root,'assets/vendor/xlsx.full.min.js'));
const config=JSON.parse(fs.readFileSync(path.join(root,'tools/nr-source-config.json'),'utf8'));
const fy=process.argv[4]||config.currentYear,startYear=Number(fy.slice(0,4)),endYear=startYear+1,isPY=fy===config.previousYear;
const dir=path.join(root,'data/mb-budget-sync/source-files',fy);
const months=['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];
const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const code=v=>{const s=String(v??'').trim().toUpperCase();if(s.includes('TOTAL'))return 'TOTAL';const m=s.match(/\d+[A-Z]?/);return m?m[0].padStart(2,'0'):'';};
function read(file){const w=X.read(fs.readFileSync(file),{type:'buffer'});const r=X.utils.sheet_to_json(w.Sheets[w.SheetNames[0]],{header:1,defval:''});const h=r.findIndex(row=>row.some(v=>norm(v)==='AU'));assert(h>=0,file);return {headers:r[h].map(norm),rows:r.slice(h+1),name:path.basename(file),rowCount:r.length,truncated:r.length>=32768,lastScope:String(r[r.length-1]?.[0]||'')};}
const master=read(path.join(root,'docs/ZONEMASTER.xls'));
const units=Object.fromEntries(master.rows.map(r=>[r[1],{code:r[1],name:r[2],short:r[3],division:r[4],type:r[5],parent:r[6]}]));
const files=config.years[fy];assert(files,'Configure filenames for '+fy);
const sources=Object.fromEntries(Object.entries(files).map(([k,names])=>[k,names.map(n=>read(path.join(dir,n)))]));
const latestPopulatedIndex=months.reduce((last,m,i)=>Object.values(sources).some(ss=>ss[1].rows.some(r=>Number(r[ss[1].headers.indexOf(norm(`${m} ${i<9?startYear:endYear}`))]||0)))?i:last,-1);
assert(latestPopulatedIndex>=0,'No populated reporting month');const reportingIndex=isPY?12:latestPopulatedIndex;
const groups=new Set(sources.au.flatMap(s=>s.rows.map(r=>String(r[0]).trim()).filter(c=>/^03\d\d$/.test(c))));
const sum=a=>a.reduce((s,v)=>s+Number(v||0),0);
const numeric=(r,i)=>i<0?0:Number(r[i]||0);
function cols(s){return {pu:s.headers.indexOf('PUCODE'),dept:s.headers.indexOf('DEPARTMENTCODE'),smh:s.headers.indexOf('SMH'),bg:s.headers.findIndex(h=>h.startsWith('BGISL')),rg:s.headers.findIndex(h=>/^RG20/.test(h)),actual:s.headers.findIndex(h=>h.includes('TILLDATE')),month:months.map((m,i)=>s.headers.indexOf(norm(`${m} ${i<9?startYear:endYear}`)))};}
function data(s,scope){return s.rows.filter(r=>scope==='03'?String(r[0]).startsWith('03 -'):String(r[0])===scope);}
function payload(scope){
 const ss=sources[scope==='03'?'zone':'au'],budget={},month={},detailMap={},demandMap={};
 const coverage=ss.map(s=>data(s,scope).length>0);const warnings=ss.filter(s=>s.truncated).map(s=>'Source may be truncated at '+s.rowCount+' rows: '+s.name);if(ss[2].truncated&&ss[2].lastScope===scope)coverage[2]=false;
 for(let n=0;n<ss.length;n++){
  const s=ss[n],c=cols(s);assert(n%2?c.month.every(i=>i>=0):c.bg>=0&&c.rg>=0,`Required ${fy} financial columns missing in ${s.name}`);assert(n<2?c.pu>=0:n<4?c.pu>=0&&c.dept>=0&&c.smh>=0:c.smh>=0,`Required reporting keys missing in ${s.name}`);
  for(const r of data(s,scope)){
   const pu=code(r[c.pu]),smh=code(r[c.smh]),dept=code(r[c.dept]);
   if(n<2){if(!pu||pu==='TOTAL')continue;
    if(n===0){assert(!budget[pu],`${scope} duplicate PU ${pu}`);budget[pu]={bg_isl:numeric(r,c.bg),rg:numeric(r,c.rg),actuals_till:numeric(r,c.actual)};}
    else {assert(!month[pu],`${scope} duplicate month PU ${pu}`);month[pu]=Object.fromEntries(months.map((m,i)=>[m,numeric(r,c.month[i])]));}
   }else if(n<4){
    if(!pu||pu==='TOTAL'||!smh||(dept==='00'&&scope!=='03')||['72','73','74','75','98'].includes(pu))continue;
    const key=[dept,smh,pu].join('|');
    const d=detailMap[key]??={au:scope,deptCode:dept,deptName:dept==='00'?'Unassigned department (source 00)':String(r[c.dept]).replace(/^\d+\s*-\s*/,''),smh:'SMH - '+smh,puCode:pu,puName:String(r[c.pu]).replace(/^PU\s*-\s*\d+\s*-\s*/,''),budget:0,actualTill:0,months:Object.fromEntries(months.map(m=>[m,0]))};
    if(n===2)d.budget+=numeric(r,c.rg)||numeric(r,c.bg);
    else months.forEach((m,i)=>d.months[m]+=numeric(r,c.month[i]));
   }else{
    if(!smh||smh==='TOTAL')continue;
    const d=demandMap[smh]??={smh,oba:0,months:Object.fromEntries(months.map(m=>[m,0]))};
    if(n===4)d.oba+=numeric(r,c.rg)||numeric(r,c.bg);else months.forEach((m,i)=>d.months[m]+=numeric(r,c.month[i]));
   }
  }
 }
 for(const pu of new Set([...Object.keys(budget),...Object.keys(month)])){
  budget[pu]??={bg_isl:0,rg:0,actuals_till:0};month[pu]??=Object.fromEntries(months.map(m=>[m,0]));budget[pu].actuals_till=sum(Object.values(month[pu]));
 }
 budget.TOTAL=Object.fromEntries(['bg_isl','rg','actuals_till'].map(k=>[k,sum(Object.values(budget).map(r=>r[k]))]));
 month.TOTAL=Object.fromEntries(months.map(m=>[m,sum(Object.values(month).map(r=>r[m]))]));
 const latest=months.reduce((idx,m,i)=>Object.values(month).some(r=>r[m])?i:idx,-1);
 const detailRows=Object.values(detailMap);detailRows.forEach(r=>r.actualTill=sum(Object.values(r.months)));
 const labels={ '01':'General administration','02':'Engineering / Permanent Way','03':'Motive power','04':'Carriages and wagons','05':'Plant and equipment','06':'Operating expenses — rolling stock and equipment','07':'Operating expenses — traffic','08':'Operating expenses — fuel','09':'Staff welfare and amenities','10':'Miscellaneous working expenses','11':'Provident fund, pension and retirement benefits','10N':'Suspense Heads'};
 const rows=Object.values(demandMap).sort((a,b)=>a.smh.localeCompare(b.smh)).map(r=>{const ae=sum(months.slice(0,reportingIndex).map(m=>r.months[m])),bp=Math.round(r.oba/12*reportingIndex);return {...r,demand:r.smh==='10N'?'12N':String(Number(r.smh)+2).padStart(2,'0'),dept:labels[r.smh]||r.smh,description:labels[r.smh]||r.smh,ae,bp,variation:ae-bp,bpPct:bp?ae/bp*100:0,budgetRemaining:r.oba-ae,obaUtil:r.oba?ae/r.oba*100:0};});
 const totals=Object.fromEntries(['oba','bp','ae','variation','budgetRemaining'].map(k=>[k,sum(rows.filter(r=>r.smh!=='10N').map(r=>r[k]))]));totals.bpPct=totals.bp?totals.ae/totals.bp*100:0;totals.obaUtil=totals.oba?totals.ae/totals.oba*100:0;
 const generatedAt=new Date().toISOString();
 const result={code:scope,label:scope==='03'?'NR Zone — 03':`${units[scope]?.name||'AU'} — ${scope}`,coverage,latestActualMonthIdx:latest,budget,month,detail:{source:ss[2].name+' + '+ss[3].name,generatedAt,monthKeys:months,monthLabels:months.map(m=>m.toUpperCase()),rows:detailRows,totals:{budget:sum(detailRows.map(r=>r.budget)),actualTill:sum(detailRows.map(r=>r.actualTill)),months:Object.fromEntries(months.map(m=>[m,sum(detailRows.map(r=>r.months[m]))]))}},warnings,demand:{fy,sourceBudget:ss[4].name,sourceActual:ss[5].name,generatedAt,asOn:'SEP 2026',completedMonths:6,note:'Completed through SEP 2026; OCT 2026 is the running month. Amounts in Rs thousands. Suspense shown separately.',rows,totals},sources:ss.map(s=>s.name)};
 // Validate source control totals independently for every PU summary.
 result.reconciliation=[];
 for(const n of [0,1]){const s=ss[n],c=cols(s),controls=data(s,scope).filter(r=>code(r[c.pu])==='TOTAL');if(controls.length){assert.equal(controls.length,1);const checks=n===0?[['bg_isl',result.budget.TOTAL.bg_isl,numeric(controls[0],c.bg)],['rg',result.budget.TOTAL.rg,numeric(controls[0],c.rg)]]:months.map((m,i)=>[m,result.month.TOTAL[m],numeric(controls[0],c.month[i])]);for(const [field,calculated,control] of checks){const delta=calculated-control,tolerance=Math.ceil(data(s,scope).length/2);assert(Math.abs(delta)<=tolerance,`${scope} ${field}: ${delta} exceeds source rounding tolerance ${tolerance}`);result.reconciliation.push({source:s.name,field,calculated,control,delta,tolerance});}}}
 return result;
}
const scopes=Object.fromEntries(['03',...Array.from(groups).sort()].map(c=>[c,payload(c)]));
for(const s of Object.values(scopes)){s.demand.completedMonths=reportingIndex;s.demand.asOn=reportingIndex?months[reportingIndex-1].toUpperCase()+' '+(reportingIndex-1<9?startYear:endYear):'NONE';s.demand.note=isPY?'Complete previous financial year through MAR '+endYear+'. Amounts in Rs thousands. Suspense shown separately.':`Completed through ${s.demand.asOn}; ${months[reportingIndex].toUpperCase()} is the running month. Amounts in Rs thousands. Suspense shown separately.`;}
const output={financialYear:fy,generatedAt:new Date().toISOString(),reportingCurrentMonthIdx:reportingIndex,master:units,scopes};
fs.mkdirSync(path.join(out,'assets/js'),{recursive:true});
const target=path.join(out,'assets/js/'+(isPY?'zone-au-py-data.js':'zone-au-data.js'));fs.writeFileSync(target+'.tmp','window.'+(isPY?'NR_ZONE_PY_DATA':'NR_ZONE_DATA')+' = '+JSON.stringify(output)+';\n');fs.renameSync(target+'.tmp',target);
console.log(JSON.stringify({financialYear:fy,scopes:Object.keys(scopes),zone:scopes['03'].budget.TOTAL,validated:'PU budget and each monthly source control',incomplete:Object.values(scopes).filter(s=>s.coverage.includes(false)).map(s=>({code:s.code,coverage:s.coverage}))},null,2));
