(function(root){
 const months=['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sum=a=>a.reduce((t,v)=>t+Number(v||0),0),actual=(r,period)=>sum(period.map(k=>r?.[k]));
 const money=n=>n==null?'Not supplied':(n/10000).toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2});
 function rows(scope,type,period,fr=false){
  if(!scope)return [];
  if(type==='scope'){const r=rows(scope,'demand',period,fr);return [{code:scope.code,name:scope.label,budget:scope.coverage[4]?sum(r.map(r=>r.budget)):null,actual:scope.coverage[5]?sum(r.map(r=>r.actual)):null}];}
  if(type==='pu')return [...new Set([...Object.keys(scope.budget),...Object.keys(scope.month)])].filter(c=>c!=='TOTAL').map(c=>{const b=scope.budget[c];return {code:c,name:PU_META.find(p=>p.code===c)?.desc||'PU '+c,budget:scope.coverage[0]?(fr||isRGActive()?Number(b?.rg)||Number(b?.bg_isl)||0:Number(b?.bg_isl)||0):null,actual:scope.coverage[1]?actual(scope.month[c],period):null};});
  if(type==='month'){const all=rows(scope,'scope',period,fr)[0];return period.map(m=>({code:m.toUpperCase(),name:m.toUpperCase(),budget:all.budget==null?null:all.budget/12,actual:scope.coverage[5]?sum(scope.demand.rows.filter(r=>r.smh!=='10N').map(r=>r.months[m])):null}));}
  if(type==='demand')return scope.demand.rows.filter(r=>r.smh!=='10N').map(r=>({code:r.demand,name:r.description,budget:scope.coverage[4]?r.oba:null,actual:scope.coverage[5]?actual(r.months,period):null}));
  const grouped={};for(const r of scope.detail.rows){const d=grouped[r.deptCode]??={code:r.deptCode,name:r.deptName,budget:0,actual:0};d.budget+=r.budget;d.actual+=actual(r.months,period);}
  return Object.values(grouped).map(r=>({...r,budget:scope.coverage[2]&&(scope.code!=='03'||r.code==='00')?r.budget:null,actual:scope.coverage[3]?r.actual:null}));
 }
 function compare(code,type,period,fr=false){
  const cy=rows(NR_ZONE_DATA.scopes[code],type,period,fr),py=rows(root.NR_ZONE_PY_DATA?.scopes[code],type,period,fr),c=new Map(cy.map(r=>[r.code,r])),p=new Map(py.map(r=>[r.code,r]));
  const keys=[...new Set([...c.keys(),...p.keys()])];if(!keys.length)return [{scope:code,type,code:'n.a.',name:'No report rows supplied for this scope / dimension',cyBudget:null,pyBudget:null,cyActual:null,pyActual:null}];
  return keys.map(key=>({scope:code,type,code:key,name:c.get(key)?.name||p.get(key)?.name,cyBudget:c.get(key)?.budget??null,pyBudget:p.get(key)?.budget??null,cyActual:c.get(key)?.actual??null,pyActual:p.get(key)?.actual??null}));
 }
 function display(id,container){
  const section=container||document.getElementById('tab-'+id);if(!section||!root.NR_ZONE_PY_DATA)return;
  let panel=section.querySelector(':scope > .nr-py-panel');if(!panel){panel=document.createElement('section');panel.className='nr-py-panel fr-table-block';section.appendChild(panel);}
  let period=months.slice(0,NR_ZONE_DATA.reportingCurrentMonthIdx),code=NR_SELECTED_SCOPE.code,type={summary:'scope',smhdetail:'dept',demandsmh:'demand',monthwise:'month',trend:'month'}[id]||'pu',data;
  if(id==='zonalfr'){
   period=NR_FR_REVIEW.period;const page=section.dataset.frPage,view=document.getElementById('frReviewView').value;
   if(page==='insight'||page==='monitor'){
    const selected=page==='insight'?(root.FR_AI_INSIGHT_ROWS||[]):(root.FR_VISIBLE_RECORDS||[]),monitor=document.getElementById('frMonitoringType').value;
    data=selected.flatMap(r=>compare(r.scope,r.dimension||monitor,period,true).filter(p=>p.code===r.code));
   }else if(view==='coverage'){panel.hidden=true;return;}
   else if(view==='divisions')data=NR_FR_REVIEW.divisions.flatMap(c=>compare(c,'scope',period,true));
   else{code=['overview','demand','controlled'].includes(view)?'03':code;type=view==='monthly'?'month':view==='controlled'?'pu':view==='overview'?'scope':'demand';data=compare(code,type,period,true);if(view==='controlled')data=data.filter(r=>NR_FR_REVIEW.controlledPUs.includes(r.code));}
  }else data=compare(code,type,period);
  if(['trend','monthwise'].includes(id)){
   let pus=getFiltered().map(p=>p.code);if(id==='trend'){const selected=document.getElementById('trendUseBPPU').checked?bpSelectedCodes():[document.getElementById('trendPUSelect').value];if(!selected.includes('ALL')&&!selected.includes('all'))pus=pus.filter(c=>selected.includes(c));}
   const totals=scope=>{const byCode=new Map(rows(scope,'pu',period).map(r=>[r.code,r]));return {budget:scope?.coverage[0]?sum(pus.map(c=>byCode.get(c)?.budget)):null,actual:scope?.coverage[1]?period.map(m=>sum(pus.map(c=>scope.month[c]?.[m]))):null};};const cy=totals(NR_ZONE_DATA.scopes[code]),py=totals(NR_ZONE_PY_DATA.scopes[code]);data=period.map((m,i)=>({scope:code,type:'month',code:m.toUpperCase(),name:m.toUpperCase()+' — selected PUs',cyBudget:cy.budget==null?null:cy.budget/12,pyBudget:py.budget==null?null:py.budget/12,cyActual:cy.actual?.[i]??null,pyActual:py.actual?.[i]??null}));
  }
  if(type==='pu'&&id!=='zonalfr'){let codes=getFiltered().map(p=>p.code);if(id==='bpanalysis')codes=getFilteredBPRows().map(r=>r.pu.code);if(id==='budgetcontrol')codes=getFilteredBudgetControlRows().map(r=>r.pu.code);if(id==='aitrend')codes=buildAITrendItems().map(r=>r.pu.code);const allowed=new Set(codes);data=data.filter(r=>allowed.has(r.code)||r.code==='n.a.');}
  if(id==='smhdetail'){const dept=document.getElementById('smhDeptFilter')?.value,smh=document.getElementById('smhCodeFilter')?.value,selected=smhSelectedCodes();if(smh&&smh!=='all'||!selected.includes('all')){const filtered=scope=>({...scope,detail:{...scope.detail,rows:scope.detail.rows.filter(r=>(!smh||smh==='all'||r.smh===smh)&&(selected.includes('all')||selected.includes(r.puCode))&&passesPUFocus(r.puCode))}});const cy=rows(filtered(NR_ZONE_DATA.scopes[code]),'dept',period),py=rows(filtered(NR_ZONE_PY_DATA.scopes[code]),'dept',period),c=new Map(cy.map(r=>[r.code,r])),p=new Map(py.map(r=>[r.code,r]));data=[...new Set([...c.keys(),...p.keys()])].map(k=>({scope:code,type:'dept',code:k,name:c.get(k)?.name||p.get(k)?.name,cyBudget:c.get(k)?.budget??null,pyBudget:p.get(k)?.budget??null,cyActual:c.get(k)?.actual??null,pyActual:p.get(k)?.actual??null}));}if(dept&&dept!=='all')data=data.filter(r=>r.code===dept);}
  panel.hidden=false;const last=period.at(-1)?.toUpperCase()||'NONE';
  const exportButtons='<div class="nr-py-export">Export comparison '+['Excel','PDF','PPT'].map(f=>'<button type="button" onclick="DisplayExport.run(\''+f+'\',\''+id+'\',{tableOnly:true,comparisonOnly:true})">'+f+'</button>').join('')+'</div>';
  panel.innerHTML=exportButtons+'<h3>Previous-year comparison — FY 2025–26 / FY 2026–27</h3><p class="fr-basis">'+esc([...new Set(data.map(r=>r.scope))].join(', ')||code)+' · Matching April–'+last+' actuals in both years; month rows compare that month only; running/future months excluded. Annual budget is RG where available (otherwise BG) in FR; other pages follow the budget selector. ₹ crore. Department sources retain existing exclusions. Missing or incomplete coverage is not treated as zero.</p><div class="fr-scroll"><table class="fr-table nr-py-table" aria-label="Previous-year same-period comparison"><thead><tr>'+['Zone / AU','Dimension','Code','Description',type==='month'?'PY monthly benchmark':'PY annual budget / monthly benchmark',type==='month'?'CY monthly benchmark':'CY annual budget / monthly benchmark','PY matched actual','CY matched actual','Actual change','YoY %'].map(v=>'<th>'+v+'</th>').join('')+'</tr></thead><tbody>'+data.map(r=>{const diff=r.cyActual==null||r.pyActual==null?null:r.cyActual-r.pyActual,pct=diff==null||!r.pyActual?null:diff/Math.abs(r.pyActual)*100;return '<tr><td>'+esc(r.scope)+'</td><td>'+esc(r.type)+'</td><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td>'+[r.pyBudget,r.cyBudget,r.pyActual,r.cyActual,diff].map(v=>'<td>'+money(v)+'</td>').join('')+'<td>'+(pct==null?'n.a.':pct.toFixed(1)+'%')+'</td></tr>';}).join('')+'</tbody></table></div>'+(data.length?'':'<p>No rows match the current selection.</p>');
  root.NR_LAST_YEAR_COMPARISON={id,period,data};
 }
 root.NR_YEAR_COMPARE={rows,compare,display};
 root.refreshNRYearComparisons=function(){for(const id of ['summary','liability','smhdetail','demandsmh','pumaster','monthwise','bpanalysis','budgetcontrol','excessshortfall','trend','aitrend','historycompare','zonalfr'])display(id);if(document.body.classList.contains('bi-view-active'))display(activeTabName(),document.getElementById('biViewPanel'));};
 document.addEventListener('change',()=>setTimeout(()=>root.refreshNRYearComparisons(),0));
 root.addEventListener('load',()=>{root.refreshNRYearComparisons();});
})(window);
