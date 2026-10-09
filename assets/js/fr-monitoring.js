(function(root){
 const fr=root.NR_FR_REVIEW,skip=['TOTAL'];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const amt=n=>n==null?'Not supplied':(n/10000).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const sum=a=>a.reduce((s,n)=>s+Number(n||0),0);
 root.frUtilClass=function(pct){return pct==null?'fr-neutral':pct>100?'fr-red':pct>50?'fr-yellow':'fr-green';};
 function colorize(){document.querySelectorAll('#frReviewContent .fr-table').forEach(t=>{const headers=[...t.tHead.rows[0].cells].map(e=>e.textContent);const index=headers.findIndex(h=>/utilis/i.test(h));if(index<0)return;[...t.tBodies[0].rows].forEach(r=>{const cell=r.cells[index];if(cell&&/%/.test(cell.textContent)){const pct=parseFloat(cell.textContent.replace(/,/g,''));cell.classList.add(frUtilClass(pct));cell.dataset.utilisation=pct;}});});}
 function rows(scope,type){
  if(type==='pu')return [...new Set([...Object.keys(scope.budget),...Object.keys(scope.month)])].filter(c=>!skip.includes(c)).map(c=>({code:c,name:PU_META.find(p=>p.code===c)?.desc||'PU '+c,budget:scope.coverage[0]?fr.budget(scope.budget[c]):null,actual:scope.coverage[1]?fr.actual(scope.month[c]):null}));
  if(type==='demand')return fr.demandRows(scope).map(r=>({...r,budget:scope.coverage[4]?r.budget:null,actual:scope.coverage[5]?r.actual:null}));
  if(type==='month'){const m=fr.metrics(scope);return fr.period.map(k=>({code:k.toUpperCase(),name:k.toUpperCase()+' 2026',budget:scope.coverage[4]?m.budget/12:null,actual:scope.coverage[5]?sum(scope.demand.rows.filter(r=>r.smh!=='10N').map(r=>r.months[k])):null}));}
  const groups={};for(const r of scope.detail.rows){const d=groups[r.deptCode]??={code:r.deptCode,name:r.deptName,budget:0,actual:0};d.budget+=r.budget;d.actual+=fr.actual(r.months);}
  if(!Object.keys(groups).length&&(!scope.coverage[2]||!scope.coverage[3]))return [{code:'n.a.',name:'Department source data not supplied',budget:scope.coverage[2]?0:null,actual:scope.coverage[3]?0:null}];
  return Object.values(groups).map(r=>({...r,budget:!scope.coverage[2]||(scope.code==='03'&&r.code!=='00')?null:r.budget,actual:scope.coverage[3]?r.actual:null}));
 }
 root.renderMonitoring=function(){
  const type=document.getElementById('frMonitoringType')?.value||'';const controls=document.getElementById('frMonitoringControls');if(!type){controls.hidden=true;return;}
  controls.hidden=false;const mode=document.getElementById('frCompareGroup').value;
  const aus=document.getElementById('frSelectedAUs');if(!aus.options.length){for(const s of Object.values(NR_ZONE_DATA.scopes).filter(s=>s.code!=='03')){const o=document.createElement('option');o.value=s.code;o.textContent=s.label;o.selected=s.code==='0307';aus.appendChild(o);}}
  const a=document.getElementById('frCompareA'),b=document.getElementById('frCompareB');
  if(!a.options.length){for(const s of Object.values(NR_ZONE_DATA.scopes)){for(const select of [a,b]){const o=document.createElement('option');o.value=s.code;o.textContent=s.label;select.appendChild(o);}}a.value='03';b.value='0307';}
  document.getElementById('frComparePair').hidden=mode!=='pair';
  const chosen=[...document.getElementById('frSelectedAUs').selectedOptions].map(o=>o.value);
  const codes=mode==='zone'?['03']:mode==='all'?Object.keys(NR_ZONE_DATA.scopes).filter(c=>c!=='03'):mode==='zoneSelected'?['03',...chosen]:chosen;
  document.getElementById('frAUChoices').hidden=!['selected','zoneSelected'].includes(mode);
  const records=codes.flatMap(c=>rows(NR_ZONE_DATA.scopes[c],type).map(r=>({...r,scope:c,label:NR_ZONE_DATA.scopes[c].label})));
  const metric=document.getElementById('frCompareMetric'),old=[...metric.selectedOptions].map(o=>o.value);
  const options=[...new Map(records.map(r=>[r.code,r.name])).entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));
  metric.innerHTML='<option value="all">All heads</option>'+options.map(([code,name])=>`<option value="${esc(code)}">${esc(code)} — ${esc(name)}</option>`).join('');const valid=old.filter(c=>c==='all'||options.some(([key])=>key===c));
  if(old.length&&!valid.length&&options.length)valid.push(options[0][0]); if(document.getElementById('frMonitoringControls').dataset.first==='yes'){valid.length=0;if(options.length)valid.push(options[0][0]);delete document.getElementById('frMonitoringControls').dataset.first;}
  [...metric.options].forEach(o=>o.selected=valid.includes(o.value));
  const selected=[...metric.selectedOptions].map(o=>o.value);
  const visible=records.filter(r=>selected.includes('all')||selected.includes(r.code)).filter(r=>!selected.includes('all')||r.budget!==0||r.actual!==0);
  visible.sort((a,b)=>(type==='month'?NR_FR_REVIEW.period.indexOf(a.code.toLowerCase())-NR_FR_REVIEW.period.indexOf(b.code.toLowerCase()):a.code.localeCompare(b.code,undefined,{numeric:true}))||a.scope.localeCompare(b.scope));root.FR_VISIBLE_RECORDS=visible;
  const titles={pu:'PU-wise',dept:'Department-wise',demand:'Demand-wise',month:'Month-wise'};
  document.getElementById('frReviewHeading').textContent='Expenditure Monitoring — '+titles[type]+' — SEP 2026';
  document.getElementById('frReviewBasis').textContent='Comparing '+codes.join(', ')+' | Actuals April–September 2026 | ₹ crore | October excluded';
  const head=type==='month'?'Monthly even-phasing benchmark (₹ Cr)':'Annual budget (₹ Cr)';
  const pct=r=>r.budget>0&&r.actual!=null?r.actual/r.budget*100:null;
  const headers=['Code','Description','Zone / Division / AU',head,'Actual Apr–Sep (₹ Cr)',type==='month'?'Benchmark achieved':'Budget utilised',type==='month'?'Actual − monthly benchmark (₹ Cr)':'Actual − 50% benchmark (₹ Cr)'];
  if(type==='month')headers[4]='Monthly actual (₹ Cr)';
  const html='<div class="fr-table-block"><h3>'+titles[type]+' budget and actual comparison</h3><div class="fr-scroll"><table class="fr-table fr-monitor-table"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+visible.map(r=>{const p=pct(r);return '<tr><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.label)+'</td><td class="fr-number">'+amt(r.budget)+'</td><td class="fr-number">'+amt(r.actual)+'</td><td class="fr-number '+frUtilClass(p)+'">'+(p==null?'n.a.':p.toFixed(1)+'%')+'</td><td class="fr-number">'+amt(r.budget==null||r.actual==null?null:r.actual-r.budget*(type==='month'?1:.5))+'</td></tr>';}).join('')+'</tbody></table></div></div>';
  const summary=codes.map(c=>{const rr=visible.filter(r=>r.scope===c);return {scope:c,label:NR_ZONE_DATA.master[c]?.short||'NR Zone',budget:rr.some(r=>r.budget==null)?null:sum(rr.map(r=>r.budget)),actual:rr.some(r=>r.actual==null)?null:sum(rr.map(r=>r.actual))};});
  const max=Math.max(1,...summary.flatMap(s=>[Math.abs(s.budget||0),Math.abs(s.actual||0)]));
  const chart='<div class="fr-chart"><h3>Selected heads — budget and actual by scope</h3><p class="fr-legend"><i></i>Budget / benchmark <i></i>Actual · ₹ crore</p>'+summary.map(s=>'<div class="fr-bar-row"><span>'+esc(s.label)+'</span><div class="fr-bar-pair"><div><i style="width:'+Math.abs(s.budget||0)/max*100+'%"></i><b>'+amt(s.budget)+'</b></div><div><i style="width:'+Math.abs(s.actual||0)/max*100+'%"></i><b>'+amt(s.actual)+'</b></div></div></div>').join('')+'</div>';
  document.getElementById('frReviewContent').innerHTML=(!codes.length||!selected.length)?'<div class="fr-empty">Select at least one AU and one head / month to monitor expenditure.</div>':chart+html;
  document.getElementById('frReviewNotes').textContent='Colours: Green ≤50%, Yellow >50–100%, Red >100% of annual budget through September. Monthly monitoring uses Green ≤100%, Yellow >100–120%, Red >120% of the monthly benchmark. Missing/nonpositive budgets show n.a. Zone and AUs are compared separately, never added together. PU view includes all source PUs, including recoveries; Demand/month views exclude Suspense. Department view follows existing detail exclusions; zonal named-department budgets are unavailable because the source codes budgets as 00. No previous-year comparison is used.';
  if(type==='month')document.querySelectorAll('.fr-monitor-table tbody tr').forEach((tr,i)=>{const p=pct(visible[i]);tr.cells[5].className='fr-number '+(p==null?'fr-neutral':p>120?'fr-red':p>100?'fr-yellow':'fr-green');});
  makeReportTablesSortable(document.getElementById('tab-zonalfr'));
 };
 const original=root.renderZonalFR;root.renderZonalFR=function(){original();root.renderMonitoring();colorize();
  const monthly=document.getElementById('frMonitoringType').value==='month',legend=document.querySelector('.fr-util-legend');
  legend.innerHTML=monthly?'<span class="fr-green">Green ≤100%</span><span class="fr-yellow">Yellow >100–120%</span><span class="fr-red">Red >120%</span> Monthly even-phasing benchmark achieved':'<span class="fr-green">Green ≤50%</span><span class="fr-yellow">Yellow >50–100%</span><span class="fr-red">Red >100%</span> Annual budget utilisation through September';
  document.querySelectorAll('#frReviewContent .fr-kpis>div').forEach(card=>{if(/Budget utilised/.test(card.textContent)){const p=parseFloat(card.querySelector('strong').textContent);card.classList.add(frUtilClass(Number.isFinite(p)?p:null));}});
 };
 root.changeMonitoring=function(){const controls=document.getElementById('frMonitoringControls'),type=document.getElementById('frMonitoringType').value;if(controls.dataset.type!==type){document.getElementById('frCompareMetric').value='all';controls.dataset.type=type;controls.dataset.first='yes';}root.renderZonalFR();};
 root.NR_MONITORING={rows};
})(window);
