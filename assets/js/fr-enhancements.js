(function(root){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const graphStates={};
 let frPage="review",savedMonitoring="pu";
 const cr=n=>n==null?'n.a.':n.toLocaleString('en-IN',{maximumFractionDigits:2});
 function checklist(id){
  const select=document.getElementById(id);if(!select)return;
  let details=document.getElementById(id+'Ticks');
  if(!details){details=document.createElement('details');details.id=id+'Ticks';details.className='fr-check-menu';select.after(details);select.classList.add('fr-native-selection');}
  const open=details.open,chosen=[...select.selectedOptions],name=/AUs$/.test(id)?'AUs':'heads / months';
  details.innerHTML='<summary>'+esc(chosen.length===1?chosen[0].textContent:chosen.length+' '+name+' selected')+'</summary><div class="fr-check-popup"><input class="fr-check-search" type="search" placeholder="Search '+name+'" aria-label="Search '+name+'"><div class="fr-check-list">'+[...select.options].map(o=>'<label><input type="checkbox" value="'+esc(o.value)+'" '+(o.selected?'checked':'')+'><span>'+esc(o.textContent)+'</span></label>').join('')+'</div></div>';details.open=open;
  details.querySelector('.fr-check-search').addEventListener('input',e=>{const text=e.target.value.toLowerCase();details.querySelectorAll('.fr-check-list label').forEach(l=>l.hidden=!l.textContent.toLowerCase().includes(text));});
  details.querySelectorAll('input[type=checkbox]').forEach(box=>box.addEventListener('change',()=>{
   const option=[...select.options].find(o=>o.value===box.value);option.selected=box.checked;
   if(box.checked&&box.value==='all')[...select.options].filter(o=>o.value!=='all').forEach(o=>o.selected=false);
   if(box.checked&&box.value!=='all'){const all=[...select.options].find(o=>o.value==='all');if(all)all.selected=false;}
   if(id.startsWith('frAI'))root.renderZonalFR();else root.changeMonitoring();
  }));
 }
 function chartData(chart){return [...chart.querySelectorAll('.fr-bar-row')].map(row=>({label:row.querySelector('span').textContent,values:[...row.querySelectorAll('.fr-bar-pair b')].map(b=>{const text=b.textContent.replace(/,/g,'').trim();return /^(?:Not|n\.a)/i.test(text)?null:Number(text);})}));}
 function draw(chart,key,data){
  const style=graphStates[key]||'bar';chart.querySelectorAll('.fr-bar-row,.fr-legend').forEach(e=>e.hidden=style!=='bar');
  const target=chart.querySelector('.fr-chart-alternative');target.innerHTML='';target.hidden=style==='bar';if(style==='bar')return;
  const max=Math.max(1,...data.flatMap(r=>r.values.filter(v=>v!=null).map(Math.abs)));
  if(style==='heat'){
   target.innerHTML='<div class="fr-scroll"><table class="fr-heat"><thead><tr><th>Scope / head</th><th>Budget / benchmark (₹ Cr)</th><th>Actual (₹ Cr)</th></tr></thead><tbody>'+data.map(r=>'<tr><th>'+esc(r.label)+'</th>'+r.values.map(v=>'<td style="background:'+(v==null?'#edf1f5':'rgba('+(v<0?'176,55,74':'26,126,158')+','+(.12+.7*Math.abs(v)/max)+')')+';color:'+(v!=null&&Math.abs(v)/max>.55?'white':'#17365d')+'">'+cr(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';return;
  }
  const canvas=document.createElement('canvas');canvas.className='fr-line-canvas';canvas.setAttribute('aria-label','Budget and actual line chart in crore');target.appendChild(canvas);
  if(root.Chart){const instance=new Chart(canvas,{type:'line',data:{labels:data.map(r=>r.label),datasets:[{label:'Budget / benchmark (₹ Cr)',data:data.map(r=>r.values[0]),borderColor:'#94acc7',backgroundColor:'#94acc722',borderWidth:3,tension:.25},{label:'Actual (₹ Cr)',data:data.map(r=>r.values[1]),borderColor:'#1878a8',backgroundColor:'#1878a822',borderWidth:3,tension:.25}]},options:{responsive:true,maintainAspectRatio:true,aspectRatio:3,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true},x:{grid:{display:false}}}}});chart._frChart=instance;return;}
  canvas.width=Math.max(480,chart.clientWidth-42);canvas.height=340;const ctx=canvas.getContext('2d'),w=canvas.width,min=Math.min(0,...data.flatMap(r=>r.values.filter(v=>v!=null))),y=v=>270-(v-min)/(max-min)*225;
  ctx.font='12px Segoe UI';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;ctx.strokeStyle='#dce7ef';ctx.beginPath();ctx.moveTo(60,y(v));ctx.lineTo(w-20,y(v));ctx.stroke();ctx.fillStyle='#50677d';ctx.fillText(v.toFixed(0),5,y(v)+4);}
  for(let si=0;si<2;si++){ctx.strokeStyle=si?'#1878a8':'#94acc7';ctx.lineWidth=3;ctx.beginPath();let started=false;data.forEach((r,i)=>{const v=r.values[si];if(v==null){started=false;return;}const x=60+i*(w-100)/Math.max(1,data.length-1);if(!started)ctx.moveTo(x,y(v));else ctx.lineTo(x,y(v));started=true;});ctx.stroke();}
  data.forEach((r,i)=>{ctx.fillStyle='#50677d';ctx.save();ctx.translate(60+i*(w-100)/Math.max(1,data.length-1),290);ctx.rotate(-.2);ctx.fillText(r.label.slice(0,18),-15,0);ctx.restore();});
 }
 function addChartControls(){document.querySelectorAll('#frReviewContent .fr-chart').forEach((chart,i)=>{
  const title=chart.querySelector('h3'),key=i+':'+title.textContent,data=chartData(chart);
  const control=document.createElement('label');control.className='fr-inline-chart-control';control.innerHTML='Chart style <select><option value="bar">Bar chart</option><option value="line">Line chart</option><option value="heat">Heat map</option></select>';title.after(control);
  const target=document.createElement('div');target.className='fr-chart-alternative';chart.appendChild(target);const select=control.querySelector('select');select.value=graphStates[key]||'bar';select.addEventListener('change',()=>{if(chart._frChart){chart._frChart.destroy();chart._frChart=null;}graphStates[key]=select.value;draw(chart,key,data);});draw(chart,key,data);
 });}
 function insightControls(){
 let host=document.getElementById('frAIControls');
 if(!host){host=document.createElement('div');host.id='frAIControls';host.className='fr-monitor-controls';document.querySelector('#tab-zonalfr .fr-toolbar').after(host);
 host.innerHTML='<label>Analyse <select id="frAIDimension" onchange="renderZonalFR()"><option value="all">All dimensions</option><option value="pu">PU wise</option><option value="dept">Department wise</option><option value="demand">Demand wise</option><option value="month">Month wise</option></select></label><label>Scope <select id="frAIGroup" onchange="renderZonalFR()"><option value="zone">Zone only</option><option value="all">All AUs</option><option value="selected">Selected AUs</option><option value="zoneSelected">Zone + selected AUs</option></select></label><label id="frAIAUChoices">Select AUs<select id="frAIAUs" multiple></select></label><label>Select heads / months<select id="frAIHeads" multiple><option value="all" selected>All heads / months</option></select></label>';
 const aus=document.getElementById('frAIAUs');for(const scope of Object.values(NR_ZONE_DATA.scopes).filter(s=>s.code!=='03')){const o=new Option(scope.label,scope.code);aus.add(o);}
 }
 host.hidden=frPage!=='insight';if(frPage!=='insight')return [];
 const dimension=document.getElementById('frAIDimension').value,group=document.getElementById('frAIGroup').value,aus=document.getElementById('frAIAUs');
 const selected=[...aus.selectedOptions].map(o=>o.value),codes=group==='zone'?['03']:group==='all'?Object.keys(NR_ZONE_DATA.scopes).filter(c=>c!=='03'):group==='zoneSelected'?['03',...selected]:selected;
 document.getElementById('frAIAUChoices').hidden=!['selected','zoneSelected'].includes(group);
 const types=dimension==='all'?['pu','dept','demand','month']:[dimension],names={pu:'PU',dept:'Department',demand:'Demand',month:'Month'};
 const records=codes.flatMap(code=>types.flatMap(type=>NR_MONITORING.rows(NR_ZONE_DATA.scopes[code],type).map(r=>({...r,scope:code,dimension:type,key:type+':'+r.code,name:names[type]+' — '+r.name}))));
 const heads=document.getElementById('frAIHeads'),old=[...heads.selectedOptions].map(o=>o.value),opts=[...new Map(records.map(r=>[r.key,r])).values()].sort((a,b)=>types.indexOf(a.dimension)-types.indexOf(b.dimension)||(a.dimension==='month'?NR_FR_REVIEW.period.indexOf(a.code.toLowerCase())-NR_FR_REVIEW.period.indexOf(b.code.toLowerCase()):a.code.localeCompare(b.code,undefined,{numeric:true})));
 heads.innerHTML='<option value="all">All heads / months</option>'+opts.map(r=>'<option value="'+esc(r.key)+'">'+esc(r.name+' ('+r.code+')')+'</option>').join('');
 const valid=old.filter(v=>v==='all'||opts.some(r=>r.key===v));if(old.length&&!valid.length)valid.push('all');[...heads.options].forEach(o=>o.selected=valid.includes(o.value));
 checklist('frAIAUs');checklist('frAIHeads');
 const chosen=[...heads.selectedOptions].map(o=>o.value);const visible=records.filter(r=>chosen.includes('all')||chosen.includes(r.key));root.FR_AI_RECORDS=visible;root.FR_AI_BASIS={dimension,group,codes};return visible;
 }
 function analysis(){
  const view=document.getElementById('frInsightType').value,panel=document.getElementById('frInsightPanel');panel.hidden=frPage!=="insight"||!view;if(!view||frPage!=="insight")return;
  let rows=insightControls();
  rows=rows.map(r=>{const pct=r.budget>0&&r.actual!=null?r.actual/r.budget*100:null,monthly=r.dimension==='month',limit=monthly?100:50;let category='Monitoring',comment='Within the '+limit+'% review benchmark.';
   if(r.budget==null||r.actual==null){category='Alert';comment='Required budget or actual data is unavailable. Complete the source coverage before drawing a spending conclusion.';}
   else if(r.budget<=0&&r.actual>0){category='Alert';comment='Expenditure is booked against a nonpositive budget. Verify the allocation and the posting.';}
   else if(pct>(monthly?120:100)){category='Alert';comment=monthly?'Monthly actual exceeds 120% of the even-phasing benchmark. Check the timing and pending commitments.':'Actual already exceeds the full annual budget. Review the allocation and commitments.';}
   else if(pct>limit){category='Look out';comment='Expenditure is above the '+limit+'% '+(monthly?'monthly':'September')+' review benchmark. Check seasonal costs and remaining commitments.';}
   else if(r.budget>0&&r.actual===0){category='Look out';comment='Budget is available with no expenditure booked for the selected period. Check planned work and posting completeness.';}
   else if(r.budget<0||r.actual<0){category='Monitoring';comment='Signed credit/recovery values are present. Review their accounting treatment; ordinary utilisation is unavailable for nonpositive budgets.';}
   const prior=root.NR_YEAR_COMPARE?.compare(r.scope,r.dimension,NR_FR_REVIEW.period,true).find(p=>p.code===r.code);if(prior){comment+=' Matching PY actual: '+cr(prior.pyActual==null?null:prior.pyActual/10000)+' Cr.';if(prior.pyActual!=null&&r.actual!=null){const delta=r.actual-prior.pyActual;comment+=' Change: '+cr(delta/10000)+' Cr'+(prior.pyActual?' ('+(delta/Math.abs(prior.pyActual)*100).toFixed(1)+'%).':'.');}}
   return {...r,pct,category,comment};
  });
  const filtered=(view==='comment'||view==='all')?rows:rows.filter(r=>r.category===({alert:'Alert',lookout:'Look out',monitoring:'Monitoring'}[view]));
  root.FR_AI_INSIGHT_ROWS=filtered;
  filtered.sort((a,b)=>({Alert:0,'Look out':1,Monitoring:2}[a.category]-{Alert:0,'Look out':1,Monitoring:2}[b.category])||(b.pct??-Infinity)-(a.pct??-Infinity)||a.code.localeCompare(b.code,undefined,{numeric:true}));
  panel.innerHTML='<h3>AI Insight — '+esc(document.getElementById('frInsightType').selectedOptions[0].textContent)+'</h3><p>September 2026 · '+esc((root.FR_AI_BASIS?.codes||[]).join(', ')||'No scopes selected')+' · Independent AI Insight selection. Data-based comments. Annual utilisation uses the 50% September benchmark; month-wise analysis uses annual budget / 12 with 100% and 120% thresholds. These rules identify exceptions; they do not infer causes or use an external AI service.</p><div class="fr-scroll"><table class="fr-table" aria-label="AI Insight"><thead><tr><th>Category</th><th>AU</th><th>Head</th><th>Budget / benchmark (₹ Cr)</th><th>Actual (₹ Cr)</th><th>Utilisation</th><th>Comment / insight</th></tr></thead><tbody>'+filtered.map(r=>'<tr><td class="'+(r.category==='Alert'?'fr-red':r.category==='Look out'?'fr-yellow':'fr-green')+'">'+r.category+'</td><td>'+esc(r.scope)+'</td><td>'+esc(r.code+' — '+r.name)+'</td><td>'+cr(r.budget==null?null:r.budget/10000)+'</td><td>'+cr(r.actual==null?null:r.actual/10000)+'</td><td>'+(r.pct==null?'n.a.':r.pct.toFixed(1)+'%')+'</td><td>'+esc(r.comment)+'</td></tr>').join('')+'</tbody></table></div>'+(filtered.length?'':'<p>No matching exceptions in the current selection.</p>');
 }
 const previous=root.renderZonalFR;root.renderZonalFR=function(){document.querySelectorAll('#frReviewContent .fr-chart').forEach(c=>c._frChart?.destroy());const monitor=document.getElementById('frMonitoringType'),saved=monitor.value;if(frPage!=='monitor')monitor.value='';previous();if(frPage!=='monitor')monitor.value=saved;checklist('frSelectedAUs');checklist('frCompareMetric');addChartControls();analysis();pageLayout();root.NR_YEAR_COMPARE?.display('zonalfr');document.querySelectorAll('#frReviewContent table').forEach(t=>{const h=t.closest('.fr-table-block,.fr-chart')?.querySelector('h3');if(h)t.setAttribute('aria-label',h.textContent);});};
 function pageLayout(){
 const host=document.getElementById('tab-zonalfr');host.dataset.frPage=frPage;
 document.querySelectorAll('.fr-page-tabs [data-fr-page]').forEach(b=>{const on=b.dataset.frPage===frPage;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
 for(const [id,page] of [['frReviewView','review'],['frMonitoringType','monitor'],['frInsightType','insight']]){const el=document.getElementById(id);el.hidden=frPage!==page;document.querySelector('label[for="'+id+'"]').hidden=frPage!==page;}
 document.getElementById('frMonitoringControls').hidden=frPage!=='monitor';const ai=document.getElementById('frAIControls');if(ai)ai.hidden=frPage!=='insight';
 for(const id of ['frReviewContent','frReviewNotes','frReviewHeading','frReviewBasis'])document.getElementById(id).hidden=frPage==='insight';
 host.querySelector('.fr-util-legend').hidden=frPage==='insight';
 }
 root.selectFRPage=function(page){frPage=page;const monitor=document.getElementById('frMonitoringType');if(page==='monitor'&&!monitor.value)monitor.value=savedMonitoring;if(page==='insight'&&!document.getElementById('frInsightType').value)document.getElementById('frInsightType').value='alert';if(monitor.value)savedMonitoring=monitor.value;root.renderZonalFR();};
 root.renderFRInsights=analysis;
 root.addEventListener('click',e=>{document.querySelectorAll('.fr-check-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});});
})(window);
