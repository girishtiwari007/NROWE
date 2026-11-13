/* Source-period FR review. The August presentation supplies the review structure,
   while every current-year amount comes from NR_ZONE_DATA. */
(function(root){
 'use strict';
 const MONTHS=['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];
 const count=NR_ZONE_DATA.reportingCurrentMonthIdx,startYear=Number(NR_ZONE_DATA.financialYear.slice(0,4));
 const endDate=new Date(startYear,3+count,0),monthName=endDate.toLocaleString('en-GB',{month:'long'}),shortMonth=endDate.toLocaleString('en-GB',{month:'short'});
 const phase=count/12,benchmarkPct=Number((phase*100).toFixed(1));
 root.NR_FR_PERIOD={count,phase,benchmarkPct,monthName,period:MONTHS.slice(0,count),label(text){
  return text.replace(/April–September 2025/g,'April–'+monthName+' '+(endDate.getFullYear()-1))
   .replace(/April–September 2026/g,'April–'+monthName+' '+endDate.getFullYear())
   .replace(/September 2026/g,monthName+' '+endDate.getFullYear())
   .replace(/1 Apr–30 Sep 2026/g,'1 Apr–'+endDate.getDate()+' '+shortMonth+' '+endDate.getFullYear())
   .replace(/SEP 2026/g,shortMonth.toUpperCase()+' '+endDate.getFullYear())
   .replace(/Apr–Sep/g,'Apr–'+shortMonth).replace(/September/g,monthName)
   .replace(/October excluded/g,(MONTHS[count]||'no running month').toUpperCase()+' excluded')
   .replace(/Six months \/ twelve months/g,count+' months / twelve months')
   .replace(/50%/g,benchmarkPct+'%').replace(/50–100%/g,benchmarkPct+'–100%');
 }};
 const PERIOD=root.NR_FR_PERIOD.period;
 const DIVISIONS=['0303','0304','0305','0306','0307','0325'];
 const CONTROL=['10','11','12','15','16','26','28','32'];
 const DEMANDS=['General superintendence and services','Repairs and maintenance — Permanent Way and works','Repairs and maintenance — motive power','Repairs and maintenance — carriages and wagons','Repairs and maintenance — plant and equipment','Operating expenses — rolling stock','Operating expenses — traffic','Operating expenses — fuel','Staff welfare and amenities','Miscellaneous working expenses','Provident fund, pension and retirement benefits'];
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const total=a=>a.reduce((s,v)=>s+Number(v||0),0);
 const actual=m=>total(PERIOD.map(k=>m?.[k]));
 const amount=n=>n==null?'Not supplied':(n/10000).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const percentage=(a,b)=>b>0?(100*a/b).toFixed(1)+'%':'n.a.';
 const budget=b=>b?.rg_available===true?(Number(b.rg)||0):Number(b?.rg)||Number(b?.bg_isl)||0;
 function demandRows(scope){return scope.demand.rows.filter(r=>r.smh!=='10N').map(r=>({code:r.demand,name:DEMANDS[Number(r.demand)-3]||r.description,budget:r.oba,actual:actual(r.months)}));}
 function metrics(scope){const r=demandRows(scope);return {budget:total(r.map(r=>r.budget)),actual:total(r.map(r=>r.actual))};}
 function table(headers,rows,title){return `<div class="fr-table-block"><h3>${escape(title)}</h3><div class="fr-scroll"><table class="fr-table"><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>`<td class="${i>1?'fr-number':''}">${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;}
 function bars(rows,title,budgetLabel='Annual budget',actualLabel=root.NR_FR_PERIOD.label('Actual April–September')){const max=Math.max(1,...rows.flatMap(r=>[Math.abs(r.budget),Math.abs(r.actual)]));return `<div class="fr-chart"><h3>${escape(title)}</h3><p class="fr-legend"><i></i>${escape(budgetLabel)} <i></i>${escape(actualLabel)} · ₹ crore</p>${rows.map(r=>`<div class="fr-bar-row"><span>${escape(r.name)}</span><div class="fr-bar-pair"><div><i style="width:${Math.abs(r.budget)/max*100}%"></i><b>${amount(r.budget)}</b></div><div><i style="width:${Math.abs(r.actual)/max*100}%"></i><b>${amount(r.actual)}</b></div></div></div>`).join('')}</div>`;}
 function reviewRows(rows){return rows.map(r=>[r.code,r.name,amount(r.budget),amount(r.budget*phase),amount(r.actual),amount(r.actual-r.budget*phase),percentage(r.actual,r.budget),amount(r.budget-r.actual)]);}
 const HEADERS=['Code','Review head','Annual budget (₹ Cr)',root.NR_FR_PERIOD.label('50% benchmark (₹ Cr)'),root.NR_FR_PERIOD.label('Actual Apr–Sep (₹ Cr)'),'Actual − benchmark (₹ Cr)','Budget utilised','Annual balance (₹ Cr)'];
 function initialize(){const periodLabel=document.querySelector('#tab-zonalfr .fr-toolbar > span');if(periodLabel)periodLabel.textContent=shortMonth.toUpperCase()+' '+endDate.getFullYear()+' · FY '+NR_ZONE_DATA.financialYear;const select=document.getElementById('frReviewView');if(!select||select.options.length)return;
  select.innerHTML=root.NR_FR_PERIOD.label('<optgroup label="September OWE review"><option value="overview">Zonal OWE overview</option><option value="demand">Demand-wise OWE</option><option value="divisions">Six-Division OWE summary</option><option value="selected">Selected AU — demand review</option></optgroup><optgroup label="Division OWE review">')+DIVISIONS.map(c=>`<option value="au:${c}">${escape(NR_ZONE_DATA.master[c].short)} — ${escape(NR_ZONE_DATA.master[c].name)}</option>`).join('')+'</optgroup><optgroup label="Expense analysis"><option value="controlled">Controllable PUs — high expenditure units</option><option value="monthly">Month-wise OWE expenditure</option><option value="coverage">Review coverage and pending inputs</option></optgroup>';
 }
 root.changeFRReview=function(){document.getElementById("frMonitoringType").value="";const value=document.getElementById('frReviewView').value;if(value.startsWith('au:'))applyNRScope(value.slice(3));else if(['overview','demand','divisions','controlled'].includes(value))applyNRScope('03');root.renderZonalFR();};
 root.renderZonalFR=function(){
  const host=document.getElementById('frReviewContent');if(!host||!root.NR_ZONE_DATA)return;initialize();
  const select=document.getElementById('frReviewView');let view=select.value;
  if(view.startsWith('au:')&&view.slice(3)!==root.NR_SELECTED_SCOPE.code){view='selected';select.value=view;}
  const scopes=NR_ZONE_DATA.scopes,zone=scopes['03'],current=root.NR_SELECTED_SCOPE||scopes['03'];
  if(current.code!=='03'&&['overview','demand','divisions','controlled'].includes(view)){view='selected';select.value=view;}
  const scope=['overview','demand','divisions','controlled'].includes(view)?zone:current;
  const m=metrics(scope),suspense=scope.demand.rows.find(r=>r.smh==='10N');
  let content='';
  if(view==='overview'){
   const rows=demandRows(zone),div=DIVISIONS.map(c=>({code:c,name:NR_ZONE_DATA.master[c].short,...metrics(scopes[c])}));
   content=table(['Review measure','Value','Basis'],[['Annual Ordinary Working Expenses budget',amount(m.budget)+' Cr','Demands 03–13; Suspense excluded'],[root.NR_FR_PERIOD.label('OWE actual through September'),amount(m.actual)+' Cr',root.NR_FR_PERIOD.label('April–September 2026')],['Budget utilised',percentage(m.actual,m.budget),'OWE actual / annual OWE budget'],[root.NR_FR_PERIOD.label('50% even-phasing benchmark'),amount(m.budget*phase)+' Cr',root.NR_FR_PERIOD.label('Six months / twelve months')],[root.NR_FR_PERIOD.label('Actual minus 50% benchmark'),amount(m.actual-m.budget*phase)+' Cr','Positive = above even-phasing benchmark'],['Suspense 12N / 10N budget',amount(suspense?.oba||0)+' Cr','Separate from OWE'],[root.NR_FR_PERIOD.label('Suspense actual through September'),amount(actual(suspense?.months))+' Cr','Separate from OWE']], root.NR_FR_PERIOD.label('Zonal OWE performance — SEP 2026'));
   content+=bars(div,'Division budget and expenditure');
   content+=table(HEADERS,reviewRows(div),'Six-Division OWE figures');
   content+=table(HEADERS,reviewRows(rows),'Demand-wise review');
  }else if(view==='demand'||view==='selected'||view.startsWith('au:')){
   const rows=demandRows(scope);content=bars(rows.map(r=>({...r,name:r.code+' '+r.name})),'Demand budget and expenditure');content+=table(HEADERS,reviewRows(rows),'Demand-wise OWE — '+scope.label);
  }else if(view==='divisions'){
   const rows=DIVISIONS.map(c=>({code:c,name:NR_ZONE_DATA.master[c].name,...metrics(scopes[c])}));
   const other={code:'Other AUs',name:'NR Zone less the six listed Divisions',budget:m.budget-total(rows.map(r=>r.budget)),actual:m.actual-total(rows.map(r=>r.actual))};
   content=bars(rows,'Six-Division OWE review');content+=table(HEADERS,reviewRows([...rows,other,{code:'03',name:'NR Zone total',...m}]),'Division allocation and expenditure');
  }else if(view==='controlled'){
   const unitRows=CONTROL.flatMap(pu=>DIVISIONS.map(c=>({code:pu,au:c,name:NR_ZONE_DATA.master[c].short,puName:scope.sources?((typeof PU_META!=='undefined'?PU_META:[]).find(p=>p.code===pu)?.desc||'PU '+pu):'PU '+pu,budget:budget(scopes[c].budget[pu]),actual:actual(scopes[c].month[pu]),available:scopes[c].coverage[0]&&scopes[c].coverage[1]})));
   const rows=CONTROL.flatMap(pu=>unitRows.filter(r=>r.code===pu&&r.available).sort((a,b)=>{const ratio=r=>r.budget>0?r.actual/r.budget:r.actual>0?Infinity:-Infinity;return ratio(b)-ratio(a)||b.actual-a.actual;}).slice(0,2));
   content=root.NR_FR_PERIOD.label('<p class="fr-note">Two highest-utilisation Divisions for each controllable PU, following slide 12. The selection is recalculated for September; no August rankings are reused.</p>');
   content+=table(['PU','Description','AU','Division','Annual budget (₹ Cr)',root.NR_FR_PERIOD.label('Actual Apr–Sep (₹ Cr)'),'Budget utilised',root.NR_FR_PERIOD.label('Actual − 50% benchmark (₹ Cr)')],rows.map(r=>[r.code,r.puName,r.au,r.name,amount(r.budget),amount(r.actual),percentage(r.actual,r.budget),amount(r.actual-r.budget*phase)]),'Controllable PU watch list');
   content+=table(['PU','Description',...DIVISIONS.map(c=>NR_ZONE_DATA.master[c].short+' actual (₹ Cr)')],CONTROL.map(pu=>[pu,unitRows.find(r=>r.code===pu)?.puName,...DIVISIONS.map(c=>amount(unitRows.find(r=>r.code===pu&&r.au===c)?.actual))]),'Controllable PU expenditure across all six Divisions');
  }else if(view==='monthly'){
   const rows=scope.demand.rows.filter(r=>r.smh!=='10N');let cumulative=0;
   content=table(['Month','Monthly benchmark (₹ Cr)','Monthly OWE (₹ Cr)','Cumulative OWE (₹ Cr)','Cumulative budget utilised'],PERIOD.map(k=>{const value=total(rows.map(r=>r.months[k]));cumulative+=value;return [k.toUpperCase()+' 2026',amount(m.budget/12),amount(value),amount(cumulative),percentage(cumulative,m.budget)];}),'Month-wise OWE — '+scope.label);
   content+=bars(PERIOD.map(k=>({name:k.toUpperCase()+' 2026',budget:m.budget/12,actual:total(rows.map(r=>r.months[k]))})),'Monthly even-phasing benchmark and actual','Annual budget / 12','Monthly actual');
  }else{
   content=table(['Reference review','Slides',root.NR_FR_PERIOD.label('September status'),'Required input'],[['OWE target and actual','2','Available','Current Zone budget and monthly OWE'],['Demand-wise OWE','5','Available','Demand/SMH Zone files'],['DLI, FZR, JAT, LKO, MB, UMB OWE','6–11','Available','AU budget and monthly actuals'],['Controllable PUs','12','Available','PU 10, 11, 12, 15, 16, 26, 28, 32'],['Revenue and apportioned earnings','2, 4','Not supplied',root.NR_FR_PERIOD.label('September revenue target and actual by Passenger, Other Coaching, Goods and Sundry')],['Operating ratio','3','Not supplied',root.NR_FR_PERIOD.label('Official September OR or matching OWE, pension/appropriation and apportioned earnings inputs')],['Net NR controlled and Zonal CAPEX','13–14','Not supplied',root.NR_FR_PERIOD.label('September plan-head outlay and expenditure')],['Agency, Construction and Division CAPEX','15–22','Not supplied',root.NR_FR_PERIOD.label('September agency/Division plan-head reports')],['Previous-year / COPPY OWE comparison','3–11','Available','FY 2025-26 scoped PU, Demand, department actual and monthly files; incomplete department budgets flagged']],'Reference coverage');
  }
  const title=select.options[select.selectedIndex].textContent;
  document.getElementById('frReviewHeading').textContent=title+root.NR_FR_PERIOD.label(' — SEP 2026');
  document.getElementById('frReviewBasis').textContent=scope.label+root.NR_FR_PERIOD.label(' | FY 2026–27 | Actuals: 1 Apr–30 Sep 2026 | ₹ crore | October excluded')+(scope.coverage.includes(false)?' | Partial source coverage: '+document.getElementById('nrScopeStatus').textContent:'');
  host.innerHTML='<div class="fr-kpis"><div><span>Annual OWE budget</span><strong>'+amount(m.budget)+root.NR_FR_PERIOD.label(' Cr</strong></div><div><span>Actual through September</span><strong>')+amount(m.actual)+' Cr</strong></div><div><span>Budget utilised</span><strong>'+percentage(m.actual,m.budget)+root.NR_FR_PERIOD.label('</strong></div><div><span>Actual − 50% benchmark</span><strong>')+amount(m.actual-m.budget*phase)+' Cr</strong></div></div>'+content;
  const footer=document.getElementById('frReviewNotes');footer.textContent=root.NR_FR_PERIOD.label('Basis: Demands 03–13; Suspense 12N/10N is separate. FR views use all relevant heads independently of the main PU display filters. Annual budget uses RG where allotted, otherwise BG_ISL. 50% is an even-phasing review benchmark, not the source-file BP. Reference: PFA FR AUG 2026, slides 2 and 5–12; September values come from the local Zone/AU workbooks. Previous-year OWE analysis uses matched April–September 2025 source data; revenue and CAPEX inputs remain pending.');
  if(root.makeReportTablesSortable)makeReportTablesSortable(document.getElementById('tab-zonalfr'));
 };
 root.NR_FR_REVIEW={period:PERIOD,divisions:DIVISIONS,controlledPUs:CONTROL,demandRows,metrics,actual,budget};
 root.addEventListener('load',()=>{if(new URLSearchParams(location.search).get('tab')==='zonalfr')switchTab('zonalfr');});
})(window);
