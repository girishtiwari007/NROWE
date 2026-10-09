/* NR scope adapter: keep every existing page on the same selected payload. */
window.nrScopeLabel = () => window.NR_SELECTED_SCOPE?.label || 'NR Zone — 03';
window.initNRScope = function () {
  const select=document.getElementById('nrScopeFilter');
  if(!select || !window.NR_ZONE_DATA) return;
  select.innerHTML='';
  for(const s of Object.values(NR_ZONE_DATA.scopes)) {
    const option=document.createElement('option');option.value=s.code;option.textContent=s.label;select.appendChild(option);
  }
  let saved='03';try{saved=localStorage.getItem('nrzone_selected_scope')||'03';}catch(e){}
  window.applyNRScope(NR_ZONE_DATA.scopes[saved]?saved:'03',false);
};
window.applyNRScope = function (code,refresh=true) {
  const source=window.NR_ZONE_DATA?.scopes[code];if(!source)throw new Error('Unknown NR AU '+code);
  const s=JSON.parse(JSON.stringify(source));window.NR_SELECTED_SCOPE=s;
  BUDGET=s.budget;MONTH=s.month;
  const py=window.NR_ZONE_PY_DATA?.scopes[code];window.NR_SELECTED_PY_SCOPE=py;BUDGET_PY=py?JSON.parse(JSON.stringify(py.budget)):{};MONTH_PY=py?JSON.parse(JSON.stringify(py.month)):{};
  window.DETAIL_SMH_DATA=s.detail;window.DEMAND_SMH_SUMMARY_DATA=s.demand;
  _latestActualMonthIdx=NR_ZONE_DATA.reportingCurrentMonthIdx;_reportingCurrentMonthIdx=NR_ZONE_DATA.reportingCurrentMonthIdx;
  _uploadedMonthIdx=null;_dataAsOnDate=new Date(NR_ZONE_DATA.generatedAt);
  document.getElementById('nrScopeFilter').value=code;
  document.title=s.label+' | NR Zone Ordinary Working Expenses';
  const header=document.querySelector('.hdr p')||document.querySelector('header p');
  if(header)header.textContent=s.label+' · Northern Railway';
  const footer=document.getElementById('portalFooter');if(footer)footer.textContent='Ordinary Working Expenses (OWE) PORTAL — '+s.label+' — Northern Railway — FY 2026-27 — For Official Use Only';
  const notice=document.getElementById('nrScopeStatus');
  const missing=s.coverage.map((yes,i)=>yes?'':['PU budget','PU monthly actual','Department budget','Department actual','Demand budget','Demand actual'][i]).filter(Boolean);
  notice.textContent=s.label+' | '+(missing.length?'Source not supplied: '+missing.join(', ')+'. ':'')+(code==='03'?'Zonal department budgets are coded 00 (Unassigned); retained without allocating them to named departments. ':'')+(py?'Previous-year FY 2025-26 matched-period comparisons loaded.'+(py.coverage[2]?'':' Previous-year department budget source is missing/incomplete.'):'Previous-year data unavailable for this scope.');
  const roles=['budgetCY','monthCY','smhBudgetCY','smhMonthCY'];roles.forEach((role,i)=>{SOURCE_REGISTER[role].source=s.sources[i];SOURCE_REGISTER[role].remarks=s.label+'; FY 2026-27. '+notice.textContent;});
  SOURCE_REGISTER.demandSmhCY.source=s.sources[4]+' + '+s.sources[5];SOURCE_REGISTER.demandSmhCY.remarks=s.label+'; '+s.demand.note;
  for(const role of ['budgetPY','monthPY']){if(SOURCE_REGISTER[role]){SOURCE_REGISTER[role].source=py?py.sources[role==='budgetPY'?0:1]:'Not supplied';SOURCE_REGISTER[role].remarks=py?s.label+'; FY 2025-26 scoped source.':'Not supplied for '+s.label;}}
  try{localStorage.setItem('nrzone_selected_scope',code);}catch(e){}
  const dept=document.getElementById('smhDeptFilter');if(dept)delete dept.dataset.ready;
  initSMHDetailFilters();
  refreshCalculatedSourceData();
  if(refresh){renderAll();renderSMHDetail();renderExcessShortfall();renderOfficerBrief();renderAdditionalRemarks();renderSyncHealthPanel();renderDataExport();}
};
