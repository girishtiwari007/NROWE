/* Compact, shared report filters. Native selects remain available to legacy exports. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const puPages=new Set(['summary','liability','monthwise','pumaster','smhdetail','bpanalysis','budgetcontrol','excessshortfall','trend','aitrend','historycompare']);
 const numeric=new Set(['budget','actual','balance','util']);
 const fields={code:'PU code',name:'Description',type:'PU type',liability:'Liability',budget:'Budget (₹ Cr)',actual:'Actual / committed (₹ Cr)',balance:'Balance (₹ Cr)',util:'Utilisation (%)',dept:'Department',demand:'Demand / SMH'};
 const state={pus:[],pages:{}};let ready=false,timer;
 const tab=()=>root.NR_FILTER_CONTEXT_TAB||(typeof activeTabName==='function'?activeTabName():'summary');
 const pageState=()=>state.pages[tab()]??={field:'',operator:'contains',value:'',sort:'',direction:'asc'};
 function meta(code){return PU_META.find(p=>p.code===code)||{code,desc:code};}
 function puRecord(pu){const c=compute(pu.code);return {code:pu.code,name:pu.desc,type:pu.puType,liability:pu.liab,budget:c.budget,actual:c.totalCommitted,balance:c.balanceBudget,util:c.utilisedPct};}
 function detailRecord(r){const p=meta(r.puCode);return {code:r.puCode,name:r.puName,type:p.puType,liability:p.liab,dept:r.deptCode+' '+r.deptName,demand:r.smh,budget:r.budget,actual:r.actualTill,balance:r.budget-r.actualTill,util:r.budget?r.actualTill/r.budget*100:null};}
 function available(){return tab()==='demandsmh'?['demand','name','budget','actual','balance','util']:tab()==='smhdetail'?Object.keys(fields):['code','name','type','liability','budget','actual','balance','util'];}
 function match(record){const s=pageState();if(!s.field||s.value.trim()==='')return true;let value=record[s.field];if(value==null)return false;
  if(numeric.has(s.field)){value=Number(value)/(s.field==='util'?1:10000);const limit=Number(s.value);if(!Number.isFinite(limit))return false;return s.operator==='gt'?value>limit:s.operator==='lt'?value<limit:Math.abs(value-limit)<1e-8;}
  const a=String(value).toLowerCase(),b=s.value.toLowerCase().trim();return s.operator==='eq'?a===b:a.includes(b);
 }
 function sort(rows,record){const s=pageState();if(!s.sort)return rows;return [...rows].sort((a,b)=>{const av=record(a)[s.sort],bv=record(b)[s.sort];if(av==null||bv==null)return av==null?(bv==null?0:1):-1;const result=numeric.has(s.sort)?Number(av)-Number(bv):String(av).localeCompare(String(bv),undefined,{numeric:true});return (s.direction==='desc'?-1:1)*result;});}
 function apply(rows,record){return sort(rows.filter(r=>match(record(r))),record);}
 function acceptPU(code){if(!puPages.has(tab()))return true;const p=meta(code),type=document.getElementById('typeFilter')?.value||'all',liability=document.getElementById('liabFilter')?.value||'all';return (type!=='Staff'||p.puType==='Staff PU')&&(type!=='Non Staff'||p.puType==='Non Staff PU')&&(type!=='specific'||state.pus.includes(code))&&(liability==='all'||p.liab===liability)&&passesPUFocus(code)&&passesActivity(code);}
 function passesActivity(code){
  if(document.getElementById('activityFilter')?.value==='budget-no-exp'&&!isBudgetNoExpense(code))return false;
  const mode=document.getElementById('utilCompare')?.value,raw=document.getElementById('utilPctFilter')?.value;
  if(mode&&mode!=='all'&&raw!==''){const value=Math.abs(compute(code).utilisedPct||0),limit=Number(raw);if(mode==='above'&&value<limit||mode==='below'&&value>limit)return false;}return true;
 }
 function refresh(){clearTimeout(timer);timer=setTimeout(()=>{if(pageState().sort&&typeof TABLE_SORT_STATE!=='undefined')for(const key of TABLE_SORT_STATE.keys())if(key.startsWith(tab()+':'))TABLE_SORT_STATE.delete(key);sync();renderAll();if(tab()==='smhdetail')renderSMHDetail();if(tab()==='excessshortfall')renderExcessShortfall();root.refreshNRYearComparisons?.();},40);}
 function menu(id,title,body){const d=document.createElement('details');d.id=id;d.className='nr-check-filter';d.innerHTML='<summary aria-label="'+esc(title)+'">'+esc(title)+'</summary><div class="nr-check-panel">'+body+'</div>';return d;}
 function searchMenu(event){const query=event.target.value.toLowerCase();event.target.closest('.nr-check-panel').querySelectorAll('label[data-search]').forEach(l=>l.hidden=!l.dataset.search.includes(query));}
 function scopeChoice(codes){root.applyNRScopes(codes);}
 function init(){if(ready)return;ready=true;
  const native=document.getElementById('nrScopeFilter');native.classList.add('nr-native-hidden');
  const scope=menu('nrScopeChecks','Zone / Division / AU','<input type="search" aria-label="Search Division or AU" placeholder="Search Division / AU…"><div class="nr-check-actions"><button type="button" data-scope-mode="zone">Zone only</button><button type="button" data-scope-mode="all">All AUs</button><button type="button" data-scope-mode="divisions">Six Divisions</button></div>'+Object.values(NR_ZONE_DATA.scopes).map(s=>'<label data-search="'+esc((s.code+' '+s.label).toLowerCase())+'"><input type="checkbox" value="'+s.code+'">'+esc(s.label)+'</label>').join('')+'<small>Zone total and AUs are separate selections.</small>');native.after(scope);
  const reviewScope=scope.cloneNode(true);reviewScope.id='nrFRScopeChecks';document.querySelector('#tab-zonalfr .fr-toolbar').prepend(reviewScope);
  for(const scopeMenu of [scope,reviewScope]){
   scopeMenu.querySelector('input[type=search]').addEventListener('input',searchMenu);
   scopeMenu.addEventListener('click',e=>{const mode=e.target.dataset.scopeMode;if(mode)scopeChoice(mode==='zone'?['03']:mode==='divisions'?NR_FR_REVIEW.divisions:Object.keys(NR_ZONE_DATA.scopes).filter(c=>c!=='03'));});
   scopeMenu.addEventListener('change',e=>{if(e.target.type!=='checkbox')return;const checks=[...scopeMenu.querySelectorAll('input[type=checkbox]')];if(e.target.checked){for(const c of checks)if((e.target.value==='03'&&c.value!=='03')||(e.target.value!=='03'&&c.value==='03'))c.checked=false;}const codes=checks.filter(c=>c.checked).map(c=>c.value);if(!codes.length){e.target.checked=true;return;}scopeChoice(codes);});
  }
  const type=document.getElementById('typeFilter');type.options[0].textContent='All PUs';type.add(new Option('Specific PU(s)…','specific'));type.setAttribute('aria-label','PU selection mode');
  const wrap=document.createElement('span');wrap.className='nr-pu-mode';type.before(wrap);wrap.appendChild(type);
  const pu=menu('nrPUChecks','Select PU(s)','<input type="search" aria-label="Search PU" placeholder="Search PU code / name…"><div class="nr-check-actions"><button type="button" data-pu-mode="all">Select all PUs</button><button type="button" data-pu-mode="none">Clear selection</button></div>'+activePUMeta().map(p=>'<label data-search="'+esc((p.code+' '+p.desc).toLowerCase())+'"><input type="checkbox" value="'+p.code+'">'+esc(p.code+' — '+p.desc)+'</label>').join(''));wrap.appendChild(pu);
  pu.querySelector('input[type=search]').addEventListener('input',searchMenu);
  pu.addEventListener('change',()=>{state.pus=[...pu.querySelectorAll('input[type=checkbox]:checked')].map(c=>c.value);refresh();});
  pu.addEventListener('click',e=>{if(!e.target.dataset.puMode)return;state.pus=e.target.dataset.puMode==='all'?activePUMeta().map(p=>p.code):[];sync();refresh();});
  type.addEventListener('change',()=>{if(type.value==='specific'){pu.open=true;}sync();});
  const advanced=document.createElement('span');advanced.id='nrFieldControls';advanced.className='nr-field-controls';advanced.innerHTML='<label>Filter by <select id="nrFieldFilter" aria-label="Filter by field"></select></label><select id="nrFieldOperator" aria-label="Filter operator"></select><input id="nrFieldValue" aria-label="Filter value" placeholder="Value"><label>Sort by <select id="nrSortField" aria-label="Sort by field"></select></label><select id="nrSortDirection" aria-label="Sort direction"><option value="asc">Ascending</option><option value="desc">Descending</option></select>';
  document.querySelector('.filter-main').appendChild(advanced);
  for(const id of ['nrFieldFilter','nrFieldOperator','nrFieldValue','nrSortField','nrSortDirection'])document.getElementById(id).addEventListener(id==='nrFieldValue'?'input':'change',()=>{const s=pageState(),field=document.getElementById('nrFieldFilter').value;if(s.field!==field){s.field=field;s.value='';s.operator=numeric.has(field)?'gt':'contains';}else{s.value=document.getElementById('nrFieldValue').value;s.operator=document.getElementById('nrFieldOperator').value;}s.sort=document.getElementById('nrSortField').value;s.direction=document.getElementById('nrSortDirection').value;refresh();});
  document.addEventListener('click',e=>{document.querySelectorAll('.nr-check-filter[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});});sync();
 }
 function sync(){if(!ready)return;
  const codes=root.nrSelectedScopeCodes?.()||['03'];document.querySelectorAll('#nrScopeChecks input[type=checkbox],#nrFRScopeChecks input[type=checkbox]').forEach(c=>c.checked=codes.includes(c.value));
  for(const summary of document.querySelectorAll('#nrScopeChecks summary,#nrFRScopeChecks summary'))summary.textContent=codes[0]==='03'?'NR Zone — 03':codes.length===1?NR_ZONE_DATA.scopes[codes[0]].label:codes.length+' AUs selected';
  const type=document.getElementById('typeFilter');document.getElementById('nrPUChecks').hidden=type.value!=='specific';document.querySelector('#nrPUChecks summary').textContent=state.pus.length+' PU(s) selected';document.querySelectorAll('#nrPUChecks input[type=checkbox]').forEach(c=>c.checked=state.pus.includes(c.value));
  const supportsPU=puPages.has(tab());document.querySelector('.nr-pu-mode').hidden=!supportsPU;
  for(const id of ['liabFilter','activityFilter','puFocusFilter'])document.getElementById(id).hidden=!supportsPU;document.querySelector('.util-filter').hidden=!supportsPU;
  const s=pageState(),options=available();document.getElementById('nrFieldControls').hidden=!supportsPU&&tab()!=='demandsmh';
  document.getElementById('nrFieldFilter').innerHTML='<option value="">All fields</option>'+options.map(k=>'<option value="'+k+'">'+fields[k]+'</option>').join('');document.getElementById('nrFieldFilter').value=s.field;
  document.getElementById('nrSortField').innerHTML='<option value="">Report order</option>'+options.map(k=>'<option value="'+k+'">'+fields[k]+'</option>').join('');document.getElementById('nrSortField').value=s.sort;
  document.getElementById('nrFieldOperator').innerHTML=numeric.has(s.field)?'<option value="gt">Above</option><option value="lt">Below</option><option value="eq">Equals</option>':'<option value="contains">Contains</option><option value="eq">Equals</option>';document.getElementById('nrFieldOperator').value=s.operator;
  document.getElementById('nrFieldValue').value=s.value;document.getElementById('nrFieldValue').type=numeric.has(s.field)?'number':'text';document.getElementById('nrFieldValue').step='any';
  for(const id of ['nrFieldValue','nrFieldOperator'])document.getElementById(id).hidden=!s.field;document.getElementById('nrSortDirection').value=s.direction;document.getElementById('nrSortDirection').hidden=!s.sort;
 }
 function clear(){state.pus=[];state.pages[tab()]={field:'',operator:'contains',value:'',sort:'',direction:'asc'};sync();}
 function exportSummary(){const s=pageState();return ['Scopes: '+(root.nrSelectedScopeCodes?.()||[]).join(', '),root.NR_SELECTED_SCOPE?.coverage.includes(false)?document.getElementById('nrScopeStatus').textContent:'',puPages.has(tab())?'PUs: '+(document.getElementById('typeFilter').value==='specific'?(state.pus.join(', ')||'None'):document.getElementById('typeFilter').selectedOptions[0].textContent):'',s.field?'Filter: '+fields[s.field]+' '+s.operator+' '+s.value:'',s.sort?'Sort: '+fields[s.sort]+' '+s.direction:''].filter(Boolean).join(' | ');}
 root.NR_FILTERS={init,sync,clear,refresh,acceptPU,puRecord,detailRecord,apply,sort,match,exportSummary,
  meta:rows=>apply(rows.filter(p=>acceptPU(p.code)),puRecord),
  detail:rows=>apply(rows.filter(r=>acceptPU(r.puCode)),detailRecord),
  demand:rows=>apply(rows,r=>({demand:r.demand+' / '+r.smh,name:r.description,budget:r.oba,actual:r.ae,balance:r.budgetRemaining,util:r.obaUtil})),
  puRows:rows=>apply(rows,r=>({...puRecord(r.pu),budget:r.budget??r.ceiling,actual:r.actualTill,balance:(r.budget??r.ceiling)-r.actualTill,util:r.utilPct})),
  fieldState:pageState,snapshot:()=>({displayMode:root.NR_SCOPE_VIEW?.get(),pus:[...state.pus],pages:JSON.parse(JSON.stringify(state.pages)),scopes:root.nrSelectedScopeCodes(),mode:document.getElementById('typeFilter').value}),restore:cfg=>{if(!cfg)return;if(cfg.displayMode)root.NR_SCOPE_VIEW?.set(cfg.displayMode);state.pus=(cfg.pus||[]).filter(c=>PU_META.some(p=>p.code===c));state.pages=cfg.pages||{};document.getElementById('typeFilter').value=cfg.mode||'all';if(cfg.scopes?.length)root.applyNRScopes(cfg.scopes,false);sync();}};
})(window);
