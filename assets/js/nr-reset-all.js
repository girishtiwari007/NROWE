/* Clear current report selections without changing source data or saved presets. */
(function(root){
 const reports=['summary','liability','monthwise','pumaster','smhdetail','demandsmh','bpanalysis','budgetcontrol','excessshortfall','trend','aitrend','historycompare','zonalfr'];
 root.resetAllPortalSelections=function(){
  const sections=reports.map(id=>document.getElementById('tab-'+id)).filter(Boolean);
  for(const section of sections){
   section.querySelectorAll('select').forEach(select=>{
    if(select.multiple)[...select.options].forEach(o=>o.selected=o.defaultSelected);
    else{const initial=[...select.options].find(o=>o.defaultSelected)||select.options[0];if(initial)select.value=initial.value;}
   });
   section.querySelectorAll('input[type=checkbox],input[type=radio]').forEach(input=>input.checked=input.defaultChecked);
   section.querySelectorAll('input[type=search],input[type=text],input[type=number]').forEach(input=>input.value=input.defaultValue||'');
  }
  const defaults={typeFilter:'all',liabFilter:'all',activityFilter:'all',puFocusFilter:'all',utilCompare:'all',utilPctFilter:'',quickSearch:'',historyFilter:'',nrGraphStyle:'bar',xsScope:'all',xsSort:'hq'};
  for(const [id,value] of Object.entries(defaults)){const input=document.getElementById(id);if(input)input.value=value;}
  root.NR_FILTERS.restore({scopes:['03'],mode:'all',pus:[],pages:{},displayMode:'separate'});
  resetTrendFilters();resetAITrendFilters();resetSMHFilters();resetBPFilters();resetBudgetControlFilters();
  for(const id of ['puMasterTypeFilter','puMasterLiabFilter','puMasterBudgetFilter','puMasterActualFilter','puMasterUtilFilter']){const input=document.getElementById(id);if(input)input.value='all';}
  for(const id of ['bpPUFilter','smhPUFilter'])filterPUChecklist(id,'');
  for(const id of ['frSelectedAUs','frAIAUs']){const select=document.getElementById(id);if(select)[...select.options].forEach(o=>o.selected=false);}
  for(const id of ['frCompareMetric','frAIHeads']){const select=document.getElementById(id);if(select)[...select.options].forEach(o=>o.selected=o.value==='all');}
  const frDefaults={frReviewView:'overview',frMonitoringType:'',frInsightType:'alert',frCompareGroup:'zone',frAIDimension:'all',frAIGroup:'zone',frCompareA:'03',frCompareB:'0307'};
  for(const [id,value] of Object.entries(frDefaults)){const el=document.getElementById(id);if(el)el.value=value;}
  root.resetFRSelections?.();
  TABLE_SORT_STATE.clear();
  document.querySelectorAll('th[aria-sort]').forEach(th=>{th.setAttribute('aria-sort','none');th.classList.remove('sort-asc','sort-desc');});
  document.querySelectorAll('.row-selected,.report-row-selected').forEach(row=>row.classList.remove('row-selected','report-row-selected'));
  document.querySelectorAll('.nr-check-filter input[type=search]').forEach(input=>input.value='');
  document.querySelectorAll('.nr-check-filter label[data-search]').forEach(label=>label.hidden=false);
  document.querySelectorAll('details[open]').forEach(details=>details.open=false);
  const results=document.getElementById('quickResults');if(results)results.replaceChildren();
  root.hidePUPopup?.();setReportViewMode('classic');setPUMasterView('table');
  root.NR_FILTERS.sync();renderAll();renderSMHDetail();renderExcessShortfall();root.refreshNRYearComparisons?.();root.NR_SCOPE_VIEW?.schedule();
  const status=document.getElementById('resetAllStatus');if(status)status.textContent='All page selections reset — NR Zone, All PUs.';
 };
})(window);
