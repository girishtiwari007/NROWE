/* Shared single/multiple-AU payload. Zone is exclusive of its constituent AUs. */
(function(root){
 'use strict';
 const months=['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];
 const sum=a=>a.reduce((n,v)=>n+Number(v||0),0),clone=v=>JSON.parse(JSON.stringify(v));
 const totals=(rows,keys)=>Object.fromEntries(keys.map(k=>[k,sum(rows.map(r=>r[k]))]));
 const effective=b=>b?.rg_available===true?(Number(b.rg)||0):Number(b?.rg)||Number(b?.bg_isl)||0;
 let selected=['03'],combined={};
 function combine(codes,py){
  const data=py?root.NR_ZONE_PY_DATA:root.NR_ZONE_DATA,ss=codes.map(c=>data?.scopes[c]);
  if(ss.some(s=>!s))return null;if(ss.length===1)return clone(ss[0]);
  const s=clone(ss[0]);s.code='selected';s.memberCodes=[...codes];s.label='Selected AUs — '+codes.join(', ');
  s.coverage=s.coverage.map((_,i)=>ss.every(r=>r.coverage[i]));s.warnings=[...new Set(ss.flatMap(r=>r.warnings||[]))];
  s.budget={};s.month={};
  const pus=[...new Set(ss.flatMap(r=>[...Object.keys(r.budget),...Object.keys(r.month)]))].filter(c=>c!=='TOTAL');
  for(const pu of pus){
   const b=ss.map(r=>r.budget[pu]);
   // AUs with no RG retain their own BG when another selected AU has RG.
   const hasRG=b.some(r=>r?.rg_available===true||Number(r?.rg));
   s.budget[pu]={bg_isl:sum(b.map(r=>r?.bg_isl)),rg:hasRG?sum(b.map(effective)):0,rg_available:hasRG,actuals_till:0};
   s.month[pu]=Object.fromEntries(months.map(m=>[m,sum(ss.map(r=>r.month[pu]?.[m]))]));
   s.budget[pu].actuals_till=sum(Object.values(s.month[pu]));
  }
  s.budget.TOTAL=totals(Object.values(s.budget),['bg_isl','rg','actuals_till']);s.month.TOTAL=totals(Object.values(s.month),months);
  const details=new Map(),demands=new Map();
  for(const scope of ss){
   for(const r of scope.detail.rows){const key=[r.deptCode,r.smh,r.puCode].join('|');let row=details.get(key);if(!row){row={...clone(r),au:'selected',budget:0,actualTill:0,months:Object.fromEntries(months.map(m=>[m,0]))};details.set(key,row);}row.budget+=r.budget;row.actualTill+=r.actualTill;for(const m of months)row.months[m]+=Number(r.months[m]||0);}
   for(const r of scope.demand.rows){let row=demands.get(r.smh);if(!row){row={...clone(r),oba:0,months:Object.fromEntries(months.map(m=>[m,0]))};demands.set(r.smh,row);}row.oba+=r.oba;for(const m of months)row.months[m]+=Number(r.months[m]||0);}
  }
  s.detail.rows=[...details.values()];s.detail.totals={budget:sum(s.detail.rows.map(r=>r.budget)),actualTill:sum(s.detail.rows.map(r=>r.actualTill)),months:totals(s.detail.rows.map(r=>r.months),months)};
  s.demand.rows=[...demands.values()].sort((a,b)=>a.smh.localeCompare(b.smh));
  for(const r of s.demand.rows){r.ae=sum(months.slice(0,data.reportingCurrentMonthIdx).map(m=>r.months[m]));r.bp=Math.round(r.oba/12*data.reportingCurrentMonthIdx);r.variation=r.ae-r.bp;r.budgetRemaining=r.oba-r.ae;r.bpPct=r.bp?r.ae/r.bp*100:0;r.obaUtil=r.oba?r.ae/r.oba*100:0;}
  s.demand.totals=totals(s.demand.rows.filter(r=>r.smh!=='10N'),['oba','bp','ae','variation','budgetRemaining']);
  s.demand.totals.bpPct=s.demand.totals.bp?s.demand.totals.ae/s.demand.totals.bp*100:0;s.demand.totals.obaUtil=s.demand.totals.oba?s.demand.totals.ae/s.demand.totals.oba*100:0;
  s.sources=s.sources.map((_,i)=>[...new Set(ss.map(r=>r.sources[i]))].join(' + '));return s;
 }
 root.nrScopeLabel=()=>root.NR_SELECTED_SCOPE?.label||'NR Zone — 03';
 root.nrSelectedScopeCodes=()=>[...selected];
 root.resolveNRScope=(code,py=false)=>code==='selected'?combined[py?'py':'cy']:(py?root.NR_ZONE_PY_DATA:root.NR_ZONE_DATA)?.scopes[code];
 root.initNRScope=function(){
  const select=document.getElementById('nrScopeFilter');if(!select||!root.NR_ZONE_DATA)return;
  select.replaceChildren(...Object.values(NR_ZONE_DATA.scopes).map(s=>new Option(s.label,s.code)),new Option('Selected AUs','selected'));
  let saved=['03'];try{saved=JSON.parse(localStorage.getItem('nrzone_selected_scopes')||'null')||[localStorage.getItem('nrzone_selected_scope')||'03'];}catch(e){}
  saved=saved.filter(c=>NR_ZONE_DATA.scopes[c]);root.NR_FILTERS?.init();root.applyNRScopes(saved.length?saved:['03'],false);
 };
 root.applyNRScope=function(code,refresh=true){root.applyNRScopes(code==='selected'?selected:[code],refresh);};
 root.applyNRScopes=function(codes,refresh=true){
  codes=[...new Set(codes)].sort();if(!codes.length)throw new Error('Select at least one Zone or AU');
  if(codes.includes('03')&&codes.length>1)throw new Error('Select the Zone total or AUs separately to avoid double counting');
  if(codes.some(c=>!NR_ZONE_DATA.scopes[c]))throw new Error('Unknown NR AU');
  selected=codes;combined={cy:combine(codes,false),py:combine(codes,true)};
  const s=combined.cy,py=combined.py;root.NR_SELECTED_SCOPE=s;root.NR_SELECTED_PY_SCOPE=py;
  BUDGET=s.budget;MONTH=s.month;BUDGET_PY=py?clone(py.budget):{};MONTH_PY=py?clone(py.month):{};
  root.DETAIL_SMH_DATA=s.detail;root.DEMAND_SMH_SUMMARY_DATA=s.demand;
  _latestActualMonthIdx=NR_ZONE_DATA.reportingCurrentMonthIdx;_reportingCurrentMonthIdx=NR_ZONE_DATA.reportingCurrentMonthIdx;_uploadedMonthIdx=null;_dataAsOnDate=new Date(NR_ZONE_DATA.generatedAt);
  document.getElementById('nrScopeFilter').value=s.code;document.title=s.label+' | NR Zone Ordinary Working Expenses';
  const header=document.querySelector('.hdr p')||document.querySelector('header p');if(header)header.textContent=s.label+' · Northern Railway';
  const footer=document.getElementById('portalFooter');if(footer)footer.textContent='Ordinary Working Expenses (OWE) PORTAL — '+s.label+' — Northern Railway — FY 2026-27 — For Official Use Only';
  const roles=['PU budget','PU monthly actual','Department budget','Department actual','Demand budget','Demand actual'];
  const missing=codes.flatMap(c=>NR_ZONE_DATA.scopes[c].coverage.map((yes,i)=>yes?'':c+': '+roles[i]).filter(Boolean));
  const notice=document.getElementById('nrScopeStatus');notice.textContent=s.label+' | '+(missing.length?'Partial selection; source not supplied: '+missing.join('; ')+'. ':'')+(s.code==='03'?'Zonal department budgets are coded 00 (Unassigned). ':'')+(py?'Previous-year matched-period comparisons loaded.'+(py.coverage[2]?'':' Previous-year department budget is missing/incomplete for at least one selected AU.'):'Previous-year data unavailable.');
  for(const [i,role] of ['budgetCY','monthCY','smhBudgetCY','smhMonthCY'].entries()){SOURCE_REGISTER[role].source=s.sources[i];SOURCE_REGISTER[role].remarks=notice.textContent;}
  SOURCE_REGISTER.demandSmhCY.source=s.sources[4]+' + '+s.sources[5];SOURCE_REGISTER.demandSmhCY.remarks=s.label+'; '+s.demand.note;
  for(const [i,role] of ['budgetPY','monthPY'].entries())if(SOURCE_REGISTER[role]){SOURCE_REGISTER[role].source=py?py.sources[i]:'Not supplied';SOURCE_REGISTER[role].remarks=s.label+'; FY 2025-26 scoped source.';}
  try{localStorage.setItem('nrzone_selected_scopes',JSON.stringify(codes));localStorage.setItem('nrzone_selected_scope',s.code);}catch(e){}
  const dept=document.getElementById('smhDeptFilter');if(dept)delete dept.dataset.ready;
  initSMHDetailFilters();refreshCalculatedSourceData();root.NR_FILTERS?.sync();
  if(refresh){renderAll();renderSMHDetail();renderExcessShortfall();renderOfficerBrief();renderAdditionalRemarks();renderSyncHealthPanel();renderDataExport();}
 };
})(window);
