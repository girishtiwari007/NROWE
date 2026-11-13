/* AU-resolved presentation, rendered from each AU's own existing report calculations. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const renderers={summary:()=>{renderCards();renderJuneBars();renderSummaryPage();},liability:()=>renderLiability(),monthwise:()=>renderMonthwise(),pumaster:()=>renderPUMaster(),smhdetail:()=>renderSMHDetail(),demandsmh:()=>renderDemandSMHSummary(),bpanalysis:()=>renderBPAnalysis(),budgetcontrol:()=>renderBudgetControl(),excessshortfall:()=>renderExcessShortfall(),trend:()=>renderTrend(),aitrend:()=>renderAITrendSummary(),historycompare:()=>{},zonalfr:()=>renderZonalFR()};
 let mode='separate',busy=false,timer,revision=0;const cache=new WeakMap();
 try{mode=localStorage.getItem('nrzone_au_view')==='combined'?'combined':'separate';}catch(e){}
 const active=()=>activeTabName();
 const label=code=>NR_ZONE_DATA.scopes[code]?.label||code;
 function enabled(id){return !!renderers[id]&&nrSelectedScopeCodes().length>1&&(id!=='zonalfr'||document.getElementById('tab-zonalfr').dataset.frPage==='review');}
 function visible(el,host){for(let n=el;n&&n!==host;n=n.parentElement)if(n.hidden||getComputedStyle(n).display==='none')return false;return true;}
 function clean(node){node.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));node.removeAttribute('id');node.querySelectorAll('[data-sort-bound],[data-sort-col],[data-sort-id]').forEach(n=>{delete n.dataset.sortBound;delete n.dataset.sortCol;delete n.dataset.sortId;});delete node.dataset.sortId;return node;}
 function withScope(code,fn){
  const saved={budget:BUDGET,month:MONTH,budgetPY:BUDGET_PY,monthPY:MONTH_PY,scope:root.NR_SELECTED_SCOPE,py:root.NR_SELECTED_PY_SCOPE,detail:root.DETAIL_SMH_DATA,demand:root.DEMAND_SMH_SUMMARY_DATA,codes:root.nrSelectedScopeCodes};
  const s=resolveNRScope(code),py=resolveNRScope(code,true);
  BUDGET=s.budget;MONTH=s.month;BUDGET_PY=py?.budget||{};MONTH_PY=py?.month||{};root.NR_SELECTED_SCOPE=s;root.NR_SELECTED_PY_SCOPE=py;root.DETAIL_SMH_DATA=s.detail;root.DEMAND_SMH_SUMMARY_DATA=s.demand;root.nrSelectedScopeCodes=()=>[code];
  try{return fn(s);}finally{BUDGET=saved.budget;MONTH=saved.month;BUDGET_PY=saved.budgetPY;MONTH_PY=saved.monthPY;root.NR_SELECTED_SCOPE=saved.scope;root.NR_SELECTED_PY_SCOPE=saved.py;root.DETAIL_SMH_DATA=saved.detail;root.DEMAND_SMH_SUMMARY_DATA=saved.demand;root.nrSelectedScopeCodes=saved.codes;}
 }
 function scopeColumn(table,text,code){
  const heads=[...table.tHead?.rows||[]];if(!heads.length)return;
  const first=heads[0].cells[0],wasAdded=first?.dataset.nrAuAdded==='1',already=/^(zone\s*\/\s*au|a\s*au|au|division\s*\/\s*au)/i.test(first?.textContent.trim()||'');
  if(already){first.textContent='Division / AU name';first.dataset.nrAuHeader='1';}
  else if(!first?.dataset.nrAuHeader){const th=document.createElement('th');th.textContent='Division / AU name';th.rowSpan=heads.length;th.dataset.nrAuHeader='1';th.dataset.nrAuAdded='1';heads[0].prepend(th);}
  for(const row of [...table.tBodies].flatMap(b=>[...b.rows]).concat([...table.tFoot?.rows||[]])){
   if(row.cells[0]?.dataset.nrAuCell){row.cells[0].textContent=text;row.dataset.nrAu=code;continue;}
   const useExisting=already&&!wasAdded,td=useExisting?row.cells[0]:document.createElement('td');if(!td)continue;
   td.textContent=text;td.classList.add('nr-au-name');td.dataset.nrAuCell='1';if(!useExisting)row.prepend(td);row.dataset.nrAu=code;
  }
  if(typeof tableHeaderLabels==='function'&&tableHeaderLabels(table).length>15)table.classList.add('nr-au-wide-table');
  const rebound=table.tHead.cloneNode(true);rebound.querySelectorAll('th').forEach(n=>{delete n.dataset.sortBound;delete n.dataset.sortCol;});table.tHead.replaceWith(rebound);
 }
 function tableTitle(t,index){return t.getAttribute('aria-label')||t.caption?.textContent||t.closest('.ai-pu-card')?.querySelector('.ai-pu-title')?.textContent||t.closest('.twrap,.bp-wrap,.bc-wrap,.smh-wrap,.demand-smh-wrap')?.querySelector('h2,h3,.ttitle,.bp-title,.bc-title,.smh-title')?.textContent||'Report table '+(index+1);}
 function snapshot(host,code,id){
  const scope=NR_SELECTED_SCOPE,frame={code,label:label(code),tables:[],charts:[],cards:[]};
  const cardSelectors=id==='summary'?'.summary-page':id==='aitrend'?'.ai-pu-card':id==='pumaster'?'#puMasterCards':'.nr-no-card';
  host.querySelectorAll(cardSelectors).forEach(card=>{if(!visible(card,host))return;const copy=clean(card.cloneNode(true));copy.querySelectorAll('table').forEach(t=>scopeColumn(t,frame.label,code));copy.querySelectorAll('.card .cl,.pu-card-head strong').forEach(n=>n.textContent=frame.label+' · '+n.textContent);frame.cards.push(copy.outerHTML);});
  host.querySelectorAll('table').forEach((t,index)=>{if(!visible(t,host)||t.closest('.ai-pu-card')||t.closest('.nr-au-output'))return;const copy=clean(t.cloneNode(true));scopeColumn(copy,frame.label,code);frame.tables.push({key:tableTitle(t,index),html:copy.outerHTML});});
  host.querySelectorAll('canvas').forEach((canvas,index)=>{
   if(!visible(canvas,host)||canvas.width===0||canvas.height===0)return;
   const chart=root.Chart?.getChart?.(canvas),title=canvas.parentElement.querySelector('.tchart-title,h3,h2')?.textContent||'Chart '+(index+1);
   try{if(chart){chart.stop();chart.update('none');}frame.charts.push({title,image:canvas.toDataURL('image/png')});}catch(e){}
   if(chart){const headers=['Category',...chart.data.datasets.map(s=>s.label||'Series')];const t=document.createElement('table');t.className='fr-table nr-au-chart-data';t.innerHTML='<thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+chart.data.labels.map((v,i)=>'<tr><td>'+esc(v)+'</td>'+chart.data.datasets.map(s=>'<td>'+esc(s.data[i]==null?'n.a.':s.data[i])+'</td>').join('')+'</tr>').join('')+'</tbody>';scopeColumn(t,frame.label,code);frame.tables.push({key:title+' — chart data',html:t.outerHTML});}
  });
  if(id==='summary'||id==='trend'){
   const pus=getFiltered(),computed=pus.map(p=>compute(p.code)),sum=k=>computed.reduce((n,c)=>n+Number(c[k]||0),0),b=sum('budget'),a=sum('totalCommitted');
   const rows=[[frame.label,b/10000,a/10000,sum('balanceBudget')/10000,b?a/b*100:null]],t=document.createElement('table');t.className='fr-table nr-au-summary';t.innerHTML='<thead><tr>'+['Division / AU name','Effective budget (₹ Cr)','Total committed (₹ Cr)','Balance (₹ Cr)','Utilisation (%)'].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr data-nr-au="'+code+'">'+r.map((v,i)=>'<td>'+esc(v==null?'Not supplied':i===0?v:Number(v).toLocaleString('en-IN',{maximumFractionDigits:2}))+'</td>').join('')+'</tr>').join('')+'</tbody>';frame.tables.unshift({key:'AU budget and expenditure',html:t.outerHTML});
  }
  frame.missing=scope.coverage.map((v,i)=>v?'':['PU budget','PU actual','Department budget','Department actual','Demand budget','Demand actual'][i]).filter(Boolean);return frame;
 }
 function merge(frames,id){
  const groups=new Map();for(const frame of frames)for(const item of frame.tables){let group=groups.get(item.key);const parsed=document.createElement('div');parsed.innerHTML=item.html;const table=parsed.firstElementChild;
   if(!group){group=table;for(const body of [...group.tBodies])body.replaceChildren();group.tFoot?.remove();groups.set(item.key,group);}
   // Rows come from each AU's own renderer, including its own subtotal/total rows.
   const source=document.createElement('div');source.innerHTML=item.html;const t=source.firstElementChild;const body=group.tBodies[0]||group.createTBody();for(const row of [...t.tBodies].flatMap(b=>[...b.rows]).concat([...t.tFoot?.rows||[]]))body.appendChild(row);
  }
  return [...groups].map(([title,table])=>'<section class="nr-au-table-block">'+(table.classList.contains('nr-py-table')?'<div class="nr-py-export">Export comparison '+['Excel','PDF','PPT'].map(f=>'<button type="button" onclick="DisplayExport.run(\''+f+'\',\''+id+'\',{tableOnly:true,comparisonOnly:true})">'+f+'</button>').join('')+'</div>':'')+'<h3>'+esc(title)+'</h3><div class="nr-au-table-scroll">'+table.outerHTML+'</div></section>').join('');
 }
 const dataSelectors='table,canvas,.pu-master-kpis,.smh-kpis,.demand-smh-kpis,.bp-kpis,.bc-kpis,.xs-kpis,#trendKPIStrip,.ai-pu-card,.ai-summary-card,.ai-dash-kpis,.fr-kpis,#puMasterCards';
 function reset(host){host.querySelectorAll('.nr-au-output').forEach(n=>n.remove());host.querySelectorAll('.nr-au-baseline').forEach(n=>n.classList.remove('nr-au-baseline'));}
 function nativeAUs(host){host.querySelectorAll('.fr-monitor-table,#frInsightPanel table,.nr-py-table').forEach(table=>{const header=table.tHead?.rows[0];if(!header)return;const index=[...header.cells].findIndex(c=>/^(zone.*au|au|division\s*\/\s*au name)$/i.test(c.textContent.trim()));if(index<0)return;const th=header.cells[index];th.textContent='Division / AU name';if(index)header.prepend(th);for(const row of [...table.tBodies].flatMap(b=>[...b.rows])){const td=row.cells[index];if(!td)continue;const code=td.textContent.match(/\b03\d\d\b|^03$/)?.[0];if(code)td.textContent=label(code);td.classList.add('nr-au-name');td.dataset.nrAuCell='1';if(index)row.prepend(td);if(code)row.dataset.nrAu=code;}});}
 function draw(id,host,bi){renderers[id]();if(bi)renderBIView();root.NR_YEAR_COMPARE?.display(id,host);}
 function ensure(id=active()){
  if(busy)return;const section=document.getElementById('tab-'+id);if(!section)return;
  const bi=id===active()&&document.body.classList.contains('bi-view-active'),host=bi?document.getElementById('biViewPanel'):section;
  const key=[revision,mode,nrSelectedScopeCodes().join(','),bi].join('|');if(cache.get(host)===key&&(!enabled(id)||mode==='combined'||host.querySelector('.nr-au-output')))return;
  if(!enabled(id)){reset(host);if(id==='zonalfr')nativeAUs(host);else if(renderers[id]&&nrSelectedScopeCodes().length===1)host.querySelectorAll('table').forEach(t=>scopeColumn(t,label(nrSelectedScopeCodes()[0]),nrSelectedScopeCodes()[0]));cache.set(host,key);return;}
  busy=true;const oldContext=root.NR_FILTER_CONTEXT_TAB;root.NR_FILTER_CONTEXT_TAB=id;
  try{
   reset(host);
   if(mode==='combined'){
    host.querySelectorAll('table').forEach(t=>scopeColumn(t,'Combined — '+nrSelectedScopeCodes().map(c=>NR_ZONE_DATA.master[c]?.short||c).join(' + '),'selected'));
   }else{
    const codes=nrSelectedScopeCodes(),frames=codes.map(code=>withScope(code,()=>{draw(id,host,bi);return snapshot(bi?document.getElementById('biViewPanel'):section,code,id);}));
    draw(id,host,bi);reset(host);
    const output=document.createElement('section');output.className='nr-au-output';output.dataset.reportTab=id;
    output.innerHTML='<div class="nr-au-view-heading"><h2>Separate Division / AU values</h2><p>'+codes.map(c=>esc(label(c))).join(' · ')+' — each row and subtotal belongs to the named AU.</p></div>'+frames.filter(f=>f.missing.length).map(f=>'<p class="nr-au-coverage">'+esc(f.label)+' — source unavailable: '+esc(f.missing.join(', '))+'.</p>').join('')+merge(frames,id)+frames.filter(f=>f.cards.length||f.charts.length).map(f=>'<section class="nr-au-detail" data-nr-au="'+f.code+'"><h3>'+esc(f.label)+'</h3>'+f.cards.join('')+f.charts.map(c=>'<figure><figcaption>'+esc(c.title)+'</figcaption><img alt="'+esc(f.label+' — '+c.title)+'" src="'+c.image+'"></figure>').join('')+'</section>').join('');
    if(bi)for(const child of [...host.children])child.classList.add('nr-au-baseline');
    else{host.querySelectorAll(dataSelectors).forEach(n=>n.classList.add('nr-au-baseline'));host.querySelectorAll('.nr-py-panel').forEach(n=>n.classList.add('nr-au-baseline'));if(['liability','monthwise'].includes(id))host.querySelectorAll('.twrap').forEach(n=>n.classList.add('nr-au-baseline'));if(id==='summary')host.querySelector('.summary-page')?.classList.add('nr-au-baseline');}
    host.appendChild(output);
   }
   root.NR_FILTERS?.sync();cache.set(host,key);makeReportTablesSortable();applyMobileTableLabels();
  }finally{root.NR_FILTER_CONTEXT_TAB=oldContext;busy=false;}
 }
 function syncMode(){for(const select of document.querySelectorAll('.nr-au-view-select')){select.value=mode;select.closest('.nr-au-view-control').hidden=nrSelectedScopeCodes().length<2;}}
 function schedule(){if(busy)return;revision++;clearTimeout(timer);syncMode();timer=setTimeout(()=>{try{ensure();}catch(e){console.error('AU view:',e);}},180);}
 function set(value){mode=value==='combined'?'combined':'separate';try{localStorage.setItem('nrzone_au_view',mode);}catch(e){}for(const key of TABLE_SORT_STATE.keys())TABLE_SORT_STATE.delete(key);schedule();}
 function control(parent,fr=false){const label=document.createElement('label');label.className='nr-au-view-control'+(fr?' nr-fr-au-view':'');label.innerHTML='AU view <select class="nr-au-view-select" aria-label="Separate or combined AU view"><option value="separate">Separate AUs</option><option value="combined">Combined</option></select>';label.querySelector('select').addEventListener('change',e=>set(e.target.value));parent.appendChild(label);}
 root.NR_SCOPE_VIEW={get:()=>mode,set,ensure,schedule,withScope};
 const baseBIRefresh=root.refreshBIViewSoon;root.refreshBIViewSoon=function(...args){if(!busy)return baseBIRefresh(...args);};
 const baseSort=root.applyTableSort;
 root.applyTableSort=function(table,col,dir){
  if(!table.closest('.nr-au-output'))return baseSort(table,col,dir);
  for(const body of table.tBodies){const groups=new Map();for(const row of [...body.rows]){const code=row.dataset.nrAu||row.closest('[data-nr-au]')?.dataset.nrAu||'';if(!groups.has(code))groups.set(code,[]);groups.get(code).push(row);}
   let entries=[...groups];if(entries.length<2){baseSort(table,col,dir);continue;}
   if(col===0)entries.sort((a,b)=>(dir==='desc'?-1:1)*label(a[0]).localeCompare(label(b[0])));
   for(const [,rows] of entries){const temp=document.createElement('table'),tbody=temp.createTBody();for(const row of rows)tbody.appendChild(row);if(col!==0)baseSort(temp,col,dir);for(const row of [...tbody.rows])body.appendChild(row);}
  }
 };
 control(document.querySelector('.filter-main'));control(document.querySelector('#tab-zonalfr .fr-toolbar'),true);
 for(const name of ['renderAll','renderLiability','renderMonthwise','renderPUMaster','renderSMHDetail','renderDemandSMHSummary','renderBPAnalysis','renderBudgetControl','renderExcessShortfall','renderSummaryPage','renderTrend','renderAITrendSummary','renderZonalFR','renderBIView','switchTab','applyNRScopes','refreshNRYearComparisons']){
  const original=root[name];if(typeof original!=='function')continue;root[name]=function(...args){const result=original.apply(this,args);schedule();return result;};
 }
 document.addEventListener('change',schedule);
 function drill(event){const action=event.target.closest('[onclick],[onkeydown]'),row=action?.closest('[data-nr-au]'),code=action?.closest('#puPopup')?.dataset.nrAu||(action?.closest('.nr-au-output')?row?.dataset.nrAu:null);if(!code)return;const handler=action.getAttribute('onclick')||action.getAttribute('onkeydown')||'',match=handler.match(/openPUDetail\('([^']+)'\)/);if(match){event.preventDefault();event.stopPropagation();withScope(code,()=>openPUDetail(match[1]));}}
 document.addEventListener('click',drill,true);document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')drill(e);},true);
 const originalPopup=root.showPUPopup;root.showPUPopup=function(...args){if(typeof _pp!=='undefined'&&_pp)delete _pp.dataset.nrAu;return originalPopup(...args);};
 document.addEventListener('mouseover',e=>{const row=e.target.closest('.nr-au-output tr[data-pu][data-nr-au]');if(!row||!isSummaryHoverTarget(e.target))return;e.stopPropagation();clearTimeout(_ppTimer);withScope(row.dataset.nrAu,()=>showPUPopup(e,row.dataset.pu));if(typeof _pp!=='undefined'&&_pp){_pp.dataset.nrAu=row.dataset.nrAu;let name=_pp.querySelector('.nr-popup-scope');if(!name){name=document.createElement('div');name.className='nr-popup-scope';_pp.prepend(name);}name.textContent=label(row.dataset.nrAu);}},true);
 schedule();
})(window);
