/* Export the displayed report, retaining editable values and native PPT objects. */
(function(root){
  'use strict';
  const portalBrand=()=>root.nrScopeLabel?.() || 'Ordinary Working Expenses (OWE) PORTAL - NR Zone';
  const pages=[['zonalfr','ZONAL FR Review'],['summary','Summary'],['liability','OWE Statement'],['smhdetail','Department wise'],['demandsmh','Demand wise'],['pumaster','PU Master'],['monthwise','Month-wise'],['bpanalysis','BP Analysis'],['budgetcontrol','Budget Control'],['excessshortfall','AE vs BP'],['trend','Graphs'],['aitrend','AI Summary'],['historycompare','History Compare']];
  const tablePages=pages.filter(([id])=>id!=='summary');
  const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
  const cleanLine=s=>String(s??'').replace(/[ \t\r\f\v]+/g,' ').replace(/\n+/g,'\n').trim();
  function visible(el){
    if(!el || el.hidden || el.style?.display==='none')return false;
    if(typeof root.getComputedStyle==='function'){
      const cs=root.getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;
    }
    return true;
  }
  function visibleInSection(el,section){
    for(let node=el;node&&node!==section;node=node.parentElement)if(!visible(node))return false;
    return true;
  }
  function cellText(cell){
    if(!cell)return '';
    const dual=cell.querySelector?.('.demand-dual,.pu-dual,.dual-money');
    if(dual){
      const parts=[...dual.querySelectorAll('span,small,strong')].map(n=>clean(n.innerText||n.textContent)).filter(Boolean);
      if(parts.length)return parts.slice(0,2).join('\n');
    }
    const text=cell.innerText||cell.textContent||'';
    return /\n/.test(text)?cleanLine(text):clean(text);
  }
  function rowExportStyle(row){
    const cls=String(row.className||'');
    if(/\b(row-selected|report-row-selected)\b/.test(cls))return 'selected';
    if(/\b(tot|dept-total|demand-smh-total)\b/.test(cls))return 'total';
    if(/\b(high|over|danger|bp-over|bc-ask|bc-support|xs-excess)\b/.test(cls))return 'danger';
    if(/\b(watch|no-exp|noexpense|bp-noexp|bc-watch)\b/.test(cls))return 'watch';
    if(/\b(saving|shortfall|bp-saving|bc-surrender|bc-saving|xs-shortfall)\b/.test(cls))return 'saving';
    if(/\bimportant-pu-row\b/.test(cls))return 'important';
    return '';
  }
  function grid(rows,repeatSpan=false){
    const result=[];
    [...rows].filter(visible).forEach((row,i)=>{
      result[i] ||= []; let col=0;
      for(const cell of row.cells){
        if(!visible(cell))continue;
        while(result[i][col]!==undefined) col++;
        const text=cellText(cell);
        for(let y=0;y<(cell.rowSpan||1);y++) for(let x=0;x<(cell.colSpan||1);x++){
          result[i+y] ||= []; result[i+y][col+x]=(x===0||repeatSpan?text:'');
        }
        col+=cell.colSpan||1;
      }
    });
    return result;
  }
  function controlName(el){
    const explicit=el.getAttribute?.('aria-label')||document.querySelector?.(`label[for="${el.id}"]`)?.textContent;
    const parent=el.closest?.('label');
    return clean(explicit||parent?.childNodes?.[0]?.textContent||el.name||el.id||'Filter');
  }
  function viewMeta(id,report,audit){
    const section=document.getElementById('tab-'+id),controls=[],seen=new Set();
    const addControl=el=>{
      if(!el||seen.has(el)||!visibleInSection(el,section)||/password/i.test(el.type||''))return;
      seen.add(el);const name=controlName(el);
      if(el.tagName==='SELECT'){
        const value=el.multiple?Array.from(el.selectedOptions||[]).map(o=>clean(o.textContent)).join('; '):clean(el.selectedOptions?.[0]?.textContent||el.value);
        if(value&&!/^all\b/i.test(value))controls.push(`${name}: ${value}`);
      }else if(el.type==='checkbox'||el.type==='radio'){
        if(el.checked)controls.push(`${name}: On`);
      }else{const value=clean(el.value);if(value)controls.push(`${name}: ${value}`);}
    };
    ['nrScopeFilter','typeFilter','liabFilter','activityFilter','puFocusFilter','utilCompare','utilPctFilter','quickSearch'].forEach(key=>addControl(document.getElementById(key)));
    section?.querySelectorAll('select,input[type="search"],input[type="text"],input[type="number"],input[type="checkbox"],input[type="radio"]').forEach(addControl);
    if(id==='zonalfr'&&document.getElementById('tab-zonalfr').dataset.frPage==='monitor'){for(const key of ['frSelectedAUs','frCompareMetric']){const el=document.getElementById(key);if(el&&((key==='frCompareMetric'&&document.getElementById('frMonitoringType').value)||['selected','zoneSelected'].includes(document.getElementById('frCompareGroup').value)))controls.push(key+': '+Array.from(el.selectedOptions).map(o=>o.textContent).join('; '));}}
    const sorts=[];
    section?.querySelectorAll('table').forEach(table=>{
      const active=table.querySelector('th[aria-sort="ascending"],th[aria-sort="descending"],th.sort-asc,th.sort-desc');
      if(active)sorts.push(`${clean(active.textContent)} ${active.getAttribute('aria-sort')||(active.classList.contains('sort-desc')?'descending':'ascending')}`);
    });
    const status=root.getMonthStatus?.()||{},bp=root.getBPModeStatus?.()||{},cur=status.cur||{};
    const completed=bp.bpThrough?`${bp.bpThrough.label} ${bp.bpThrough.year||''}`.trim():'None';
    const running=cur.label?`${cur.label} ${cur.year||''}`.trim():'Not selected';
    const generated=new Date().toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
    return {title:report.title,basis:id==='zonalfr'?'Actuals 1 April–30 September 2026; October excluded; FY 2026–27':`Completed through ${completed}; running month ${running}`,
      filters:controls.length?controls.join(' | '):'No active filters; all visible rows',
      sort:sorts.length?sorts.join(' | '):'Current displayed order',generated,source:`Source ${audit.id}`,
      period:`${report.title} | ${generated}`};
  }
  function capture(id,options={}){
    const tableOnly=!!options.tableOnly;
    const section=(document.body.classList.contains('bi-view-active') && id===(root.activeTabName?.()||id) && document.getElementById('biViewPanel'))
      ? document.getElementById('biViewPanel')
      : document.getElementById('tab-'+id);
    if(!section) throw new Error('Report unavailable: '+id);
    const tables=[...section.querySelectorAll(options.comparisonOnly?'.nr-py-table':'table')].filter(t=>visibleInSection(t,section)).map((t,i)=>{
      const bodyRows=[...t.tBodies].flatMap(b=>[...b.rows]).concat([...t.tFoot?.rows||[]]).filter(row=>visibleInSection(row,section));
      const header=grid(t.tHead?.rows||[],true), rows=grid(bodyRows);
      const n=Math.max(0,...header.map(r=>r.length),...rows.map(r=>r.length));
      const headers=Array.from({length:n},(_,c)=>[...new Set(header.map(r=>r[c]).filter(Boolean))].join(' / ')||`Column ${c+1}`);
      const context=t.closest('.twrap,.bp-wrap,.bc-wrap,.smh-wrap,.demand-smh-wrap,.history-compare-wrap,.ai-pu-card,.card')||section;
      const tableTitle=clean(t.caption?.textContent)||clean(t.getAttribute('aria-label'))||clean(context.querySelector?.('h2,h3,.ttitle,.bp-title,.bc-title,.smh-title,.ai-pu-title,.tchart-title')?.textContent)||`Table ${i+1}`;
      return {title:tableTitle,headers,rows:rows.map(r=>Array.from({length:n},(_,c)=>r[c]||'')),rowStyles:bodyRows.map(rowExportStyle)};
    }).filter(t=>t.rows.length);
    const charts=[];
    section.querySelectorAll('canvas').forEach(canvas=>{
      if(options.comparisonOnly)return;
      if(!visibleInSection(canvas,section))return;
      const chart=root.Chart?.getChart?.(canvas); if(!chart)return;
      const labels=chart.data.labels.map(clean);
      const series=chart.data.datasets.filter((_,i)=>chart.isDatasetVisible(i)).map(d=>({name:clean(d.label),labels,values:d.data.map(v=>v==null?null:Number(v))}));
      if(series.length) charts.push({title:canvas.id,type:chart.config.type,series});
    });
    if(!tableOnly&&!charts.length)for(const table of tables){
      const monthCols=table.headers.map((h,i)=>/\b(APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|JAN|FEB|MAR)\b/i.test(h)?i:-1).filter(i=>i>=0);
      if(monthCols.length<2)continue;
      const series=table.rows.map(row=>({name:clean(row[0])+' '+clean(row[1]),labels:monthCols.map(i=>table.headers[i]),values:monthCols.map(i=>{
        const raw=clean(row[i]).replace(/,/g,'');return /^[+-]?\d+(\.\d+)?$/.test(raw)?Number(raw):null;
      })})).filter(s=>s.values.some(v=>v!==null));
      for(let i=0;i<series.length;i+=6)charts.push({title:table.title+' monthly series '+(i/6+1),type:'line',series:series.slice(i,i+6)});
    }
    for(const chart of charts) tables.push({title:chart.title+' (chart data)',headers:['Category',...chart.series.map(s=>s.name)],rows:chart.series[0].labels.map((label,i)=>[label,...chart.series.map(s=>s.values[i])])});
    const notes=tableOnly?[]:[...new Set([...section.querySelectorAll('.kpi,.card,.summary-card,.summary-point,.prog-item,.ai-dash-kpi,.bi-kpi,.ai-pu-head,.ai-kpi-row,.ai-bullets,.ai-digest-head,.ai-summary-card,.chart-note,.formula-note,.pu-master-kpi,.pu-card')].filter(visible).map(n=>clean(n.innerText||n.textContent)).filter(Boolean))];
    if(!tables.length && !notes.length) throw new Error('Open '+id+' first and allow its data to finish loading before exporting.');
    return {id,title:id==='zonalfr'?(document.getElementById('tab-zonalfr').dataset.frPage==='insight'?'AI Insight — SEP 2026':document.getElementById('frReviewHeading')?.textContent||'ZONAL FR Review'):(pages.find(p=>p[0]===id)||[id,id])[1],tables,charts,notes};
  }
  function bands(table,max=7){
    if(table.headers.length<=max)return [table];
    const out=[];
    for(let c=2;c<table.headers.length;c+=max-2){
      const indices=[0,1,...Array.from({length:Math.min(max-2,table.headers.length-c)},(_,i)=>i+c)];
      out.push({title:table.title+` - columns ${c+1}-${indices.at(-1)+1}`,headers:indices.map(i=>table.headers[i]),rows:table.rows.map(r=>indices.map(i=>r[i])),rowStyles:table.rowStyles||[]});
    }
    return out;
  }
  function typed(value,col,header){
    if(typeof value==='number')return value;
    const s=clean(value);
    if(col===0 || /code|unit|department|name|description|year|month|category/i.test(header))return s;
    const raw=s.replace(/,/g,'');
    if(/^[+-]?\d+(\.\d+)?$/.test(raw))return Number(raw);
    return s;
  }
  function fillForStyle(style){
    if(style==='selected')return 'FFFFF4A8';
    if(style==='total')return 'FFD2E2F4';
    if(style==='danger')return 'FFFFE1E6';
    if(style==='watch'||style==='important')return 'FFFFF2E2';
    if(style==='saving')return 'FFEAF7EF';
    return '';
  }
  function pdfFillForStyle(style){
    if(style==='selected')return [255,244,168];
    if(style==='total')return [210,226,244];
    if(style==='danger')return [255,225,230];
    if(style==='watch'||style==='important')return [255,242,226];
    if(style==='saving')return [234,247,239];
    return null;
  }
  function pptFillForStyle(style){
    const fill=fillForStyle(style);
    return fill?fill.slice(2):'FFFFFF';
  }
  async function excel(reports,meta,ExcelJS,options={}){
    const cleanHeader=!!options.cleanHeader;
    const wb=new ExcelJS.Workbook();wb.creator=portalBrand();
    let count=0;
    for(const report of reports){
      const tables=[...report.tables,...(report.notes.length?[{title:'Review',headers:['Review note'],rows:report.notes.map(n=>[n])}]:[])];
      for(const table of tables) for(const part of bands(table)){
        const headerRow=cleanHeader?1:8;
        const firstDataRow=headerRow+1;
        const ws=wb.addWorksheet(`${++count} ${report.title}`.slice(0,31),{pageSetup:{orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.35,right:.35,top:.35,bottom:.45,header:.2,footer:.2}},views:[{state:'frozen',ySplit:headerRow}]});
        if(!cleanHeader){
          ws.addRow(['NORTHERN RAILWAY - MORADABAD DIVISION']);
          ws.addRow([portalBrand()]);
          ws.addRow([report.title+' - '+part.title]);
          ws.addRow(['Reporting basis: '+meta.basis]);
          ws.addRow(['Filters / search: '+meta.filters]);
          ws.addRow(['Sort order: '+meta.sort]);
          ws.addRow(['Generated: '+meta.generated+'; '+meta.source]);
        }
        ws.addRow(part.headers);
        part.rows.forEach(r=>ws.addRow(r.map((v,c)=>typed(v,c,part.headers[c]))));
        const widths=part.headers.map((h,c)=>{
          const maxLen=Math.max(String(h||'').length,...part.rows.slice(0,80).map(r=>String(r[c]??'').split('\n').reduce((m,line)=>Math.max(m,line.length),0)));
          return Math.max(12,Math.min(part.headers.length===1?110:34,maxLen+3));
        });
        ws.columns=widths.map(width=>({width}));
        if(!cleanHeader)for(let r=1;r<=7;r++)if(part.headers.length>1)ws.mergeCells(r,1,r,part.headers.length);
        ws.autoFilter={from:{row:headerRow,column:1},to:{row:Math.max(headerRow,ws.rowCount),column:part.headers.length}};
        ws.eachRow((row,i)=>{
          row.height=(!cleanHeader&&i<=4)?30:Math.max(24,...row.values.slice(1).map((v,idx)=>{
            const width=widths[Math.max(0,idx-1)] || 18;
            const lines=String(v??'').split('\n');
            return lines.reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/Math.max(width-3,10))),0)*13+8;
          }));
          const bodyStyle=i>headerRow?part.rowStyles?.[i-firstDataRow]:'';
          const rowFill=fillForStyle(bodyStyle);
          row.eachCell({includeEmpty:true},cell=>{
            cell.font={name:'Times New Roman',size:10,bold:i<=headerRow};
            cell.alignment={vertical:'middle',wrapText:true};
            cell.border={top:{style:'thin',color:{argb:'FF000000'}},left:{style:'thin',color:{argb:'FF000000'}},bottom:{style:'thin',color:{argb:'FF000000'}},right:{style:'thin',color:{argb:'FF000000'}}};
            if(typeof cell.value==='number')cell.numFmt='#,##0.00;[Red]-#,##0.00';
            if(!cleanHeader&&i<=2){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};cell.font={name:'Times New Roman',size:12,bold:true,color:{argb:'FFFFFFFF'}};}
            else if(!cleanHeader&&i===3){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD2E2F4'}};cell.font={name:'Times New Roman',size:11,bold:true,color:{argb:'FF17365D'}};}
            else if(i===headerRow) {cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};cell.font={name:'Times New Roman',size:10,bold:true,color:{argb:'FFFFFFFF'}};}
            else if(rowFill){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:rowFill}};}
          });
        });
        ws.pageSetup.printTitlesRow=`${headerRow}:${headerRow}`;ws.pageSetup.printArea=`A1:${ws.getColumn(part.headers.length).letter}${ws.rowCount}`;
        ws.headerFooter.oddFooter='&LFor Official Use Only&RPage &P of &N';
      }
    }
    return wb.xlsx.writeBuffer();
  }
  async function pdf(reports,meta,jsPDF,fonts,options={}){
    const cleanHeader=!!options.cleanHeader;
    const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
    const embeddedFonts=fonts&&Object.keys(fonts).length===2;
    if(embeddedFonts)for(const [style,data] of Object.entries(fonts)){doc.addFileToVFS(style+'.ttf',data);doc.addFont(style+'.ttf','TimesNewRoman',style);}
    const pdfFont=embeddedFonts?'TimesNewRoman':'times';
    const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight();let started=false;
    for(const report of reports) for(const table of [...report.tables,...(report.notes.length?[{title:'Review',headers:['Review note'],rows:report.notes.map(n=>[n])}]:[])])for(const part of bands(table)){
      if(started)doc.addPage();started=true;
      const startY=cleanHeader?42:113;
      doc.autoTable({head:[part.headers],body:part.rows.map(r=>r.map(v=>typeof v==='number'?v.toFixed(2):v)),startY,margin:{top:startY,bottom:35,left:32,right:32},theme:'grid',showHead:'everyPage',styles:{font:pdfFont,fontSize:10,cellPadding:4,overflow:'linebreak',lineColor:[0,0,0],lineWidth:.35},headStyles:{fillColor:[23,54,93],fontStyle:'bold',lineColor:[0,0,0]},alternateRowStyles:{fillColor:[245,248,251]},rowPageBreak:'avoid',didParseCell:data=>{
        if(data.section==='body'){
          const fill=pdfFillForStyle(part.rowStyles?.[data.row.index]);
          if(fill)data.cell.styles.fillColor=fill;
        }
      },didDrawPage:()=>{
        doc.setFont(pdfFont,'bold');doc.setFontSize(14);doc.setTextColor(23,54,93);doc.text(cleanHeader?part.title:report.title,32,27);
        if(!cleanHeader){
          doc.setFont(pdfFont,'normal');doc.setFontSize(10);doc.setTextColor(40);
          doc.text(portalBrand(),32,43);doc.text('Reporting basis: '+meta.basis,32,57);
          doc.text(doc.splitTextToSize('Filters / search: '+meta.filters,W-64).slice(0,2),32,71);
          doc.text(doc.splitTextToSize('Sort order: '+meta.sort,W-64).slice(0,1),32,91);
          doc.text('Generated: '+meta.generated,32,105);
        }
        doc.text('Displayed values and units. For Official Use Only.',32,H-18);doc.text(String(doc.internal.getCurrentPageInfo().pageNumber),W-32,H-18,{align:'right'});
      }});
    }
    return doc;
  }
  async function ppt(reports,meta,PptxGenJS,options={}){
    const tableOnly=!!options.tableOnly;
    const cleanHeader=!!options.cleanHeader;
    const deck=new PptxGenJS();deck.layout='LAYOUT_WIDE';deck.author=portalBrand();deck.subject=meta.period;
    deck.theme={headFontFace:'Times New Roman',bodyFontFace:'Times New Roman',lang:'en-IN'};
    const safe={left:.5,top:1.25,width:12.3,height:5.65};
    function slide(title,sub=''){const s=deck.addSlide();s.background={color:'FFFFFF'};s.addShape(deck.ShapeType.rect,{x:0,y:0,w:13.33,h:.18,fill:{color:'C9A84C'},line:{color:'C9A84C'}});s.addText(title,{x:.5,y:.32,w:12.3,h:.45,fontSize:22,bold:true,color:'17365D',margin:0,fit:'shrink'});s.addText(sub||meta.period,{x:.5,y:.84,w:12.3,h:.3,fontSize:10,color:'40566E',margin:0,fit:'shrink'});s.addText(portalBrand()+'  |  For Official Use Only',{x:.5,y:7.1,w:11.5,h:.2,fontSize:10,color:'607080',margin:0});return s;}
    function addBullets(s,items,y=1.35,title='Key view points'){
      s.addText(title,{x:.55,y,w:12.2,h:.28,fontSize:13,bold:true,color:'17365D',margin:0});
      const lines=items.slice(0,10).map(x=>'• '+String(x).slice(0,170)).join('\n');
      s.addText(lines||'• No review note available for the current view.',{x:.65,y:y+.42,w:12,h:4.8,fontSize:13,color:'111111',breakLine:false,fit:'shrink',margin:.02});
    }
    function tableRowsForSlides(part,mode='appendix'){
      const cols=part.headers.length;
      if(mode==='exceptions')return 9;
      return cols<=5?10:cols<=7?8:6;
    }
    function exceptionRows(table){
      const styles=table.rowStyles||[];
      return table.rows.map((row,i)=>({row,style:styles[i]})).filter(r=>r.style&&r.style!=='').slice(0,12);
    }
    if(!tableOnly&&!cleanHeader){
      const cover=slide('Ordinary Working Expenses Review','Current View Export');
      cover.addText(reports.map(r=>r.title).join('\n'),{x:.65,y:1.55,w:11.9,h:2.6,fontSize:20,bold:true,color:'17365D',breakLine:false,fit:'shrink',margin:0});
      cover.addText('Reporting basis: '+meta.basis+'\nFilters / search: '+meta.filters+'\nSort order: '+meta.sort+'\nGenerated: '+meta.generated,{x:.65,y:4.1,w:11.9,h:1.35,fontSize:12,color:'40566E',fit:'shrink',margin:0});
      cover.addText('Generated from the visible portal view, including its current columns, row order, search results and table highlights.',{x:.65,y:5.65,w:11.9,h:.7,fontSize:12,color:'111111',fit:'shrink',margin:0});
    }
    for(const report of reports){
      if(!tableOnly){
        const summary=slide(report.title+' - summary','Portal current view summary');
        addBullets(summary,report.notes.length?report.notes:report.tables.flatMap(t=>t.rows.slice(0,3).map(r=>r.slice(0,3).join(' | '))),1.35,'Visible cards / review notes');
      }
      if(!tableOnly)for(const chart of report.charts){
        const s=slide(report.title+' - '+chart.title);
        s.addChart(deck.ChartType.line,chart.series,{x:.6,y:1.45,w:12.1,h:5.25,showLegend:true,showTitle:false,catAxisLabelFontSize:10,valAxisLabelFontSize:10,legendFontSize:10,showValue:false,chartColors:['17365D','31836A','B87824','9B2226','C9A84C'],showBorder:false});
      }
      if(!tableOnly)for(const table of report.tables){
        const highlighted=exceptionRows(table);
        if(highlighted.length){
          const ex={title:table.title+' - highlighted rows',headers:table.headers,rows:highlighted.map(x=>x.row),rowStyles:highlighted.map(x=>x.style)};
          for(const part of bands(ex,6)){
            const rowsPer=tableRowsForSlides(part,'exceptions');
            for(let offset=0;offset<part.rows.length;offset+=rowsPer){
              const s=slide(report.title+' - highlights','Selected / exception rows shown in portal');
              s.addText(part.title+` (rows ${offset+1}-${Math.min(offset+rowsPer,part.rows.length)})`,{x:safe.left,y:1.2,w:safe.width,h:.25,fontSize:10,color:'40566E',margin:0});
              const bodyRows=part.rows.slice(offset,offset+rowsPer).map((r,ri)=>r.map(v=>({text:String(v??''),options:{fill:pptFillForStyle(part.rowStyles?.[offset+ri]),color:'111111'}})));
              s.addTable([part.headers.map(text=>({text,options:{bold:true,color:'FFFFFF',fill:'17365D'}})),...bodyRows],{x:safe.left,y:1.55,w:safe.width,fontFace:'Times New Roman',fontSize:10,border:{type:'solid',pt:.5,color:'000000'},margin:4,autoPage:false,rowH:.42,verbose:false});
            }
          }
        }
      }
      for(const table of report.tables)for(const part of bands(table,6)){
        const rowsPer=tableRowsForSlides(part);
        for(let offset=0;offset<part.rows.length;offset+=rowsPer){
          const s=slide(report.title+(tableOnly||cleanHeader?' - table data':' - appendix'),tableOnly||cleanHeader?'Formatted report table':'Editable table appendix');
          s.addText(part.title+` (rows ${offset+1}-${Math.min(offset+rowsPer,part.rows.length)})`,{x:safe.left,y:1.2,w:safe.width,h:.25,fontSize:10,color:'40566E',margin:0});
          const bodyRows=part.rows.slice(offset,offset+rowsPer).map((r,ri)=>r.map(v=>({text:String(v??''),options:{fill:pptFillForStyle(part.rowStyles?.[offset+ri]),color:'111111'}})));
          s.addTable([part.headers.map(text=>({text,options:{bold:true,color:'FFFFFF',fill:'17365D'}})),...bodyRows],{x:safe.left,y:1.55,w:safe.width,fontFace:'Times New Roman',fontSize:10,border:{type:'solid',pt:.5,color:'000000'},margin:4,autoPage:false,rowH:.42,verbose:false});
        }
      }
      if(!tableOnly&&report.notes.length){
        const lines=report.notes.flatMap(n=>n.match(/.{1,105}(?:\s|$)|.{1,105}/g)||[]);
        for(let i=0;i<lines.length;i+=12){const s=slide(report.title+' - review notes');addBullets(s,lines.slice(i,i+12),1.35,'Detailed review notes');}
      }
    }
    return deck;
  }
  let fontCache=null;
  async function fonts(){
    if(fontCache)return fontCache;
    try{
      const result={};
      for(const [style,file] of [['normal','times.ttf'],['bold','timesbd.ttf']]){
        const url=new URL('assets/fonts/'+file,document.baseURI).href;
        const response=await fetch(url,{cache:'force-cache'});
        if(!response.ok)throw new Error(`font request ${response.status}`);
        const bytes=new Uint8Array(await response.arrayBuffer());let raw='';for(const b of bytes)raw+=String.fromCharCode(b);result[style]=btoa(raw);
      }
      fontCache=result;return result;
    }catch(error){
      console.warn('Custom PDF font unavailable; using built-in Times font.',error);
      return {};
    }
  }
  async function run(format,which,options={}){
    const tableOnly=!!options.tableOnly;
    const currentView=!!options.currentView;
    const cleanHeader=!!options.cleanHeader||currentView;
    root.__pendingDisplayExport={format,which,options:Object.assign({},options)};
    if(!confirmProtectedExport(`Display ${format} ${which}${tableOnly?' TableOnly':''}`))return;
    root.__pendingDisplayExport=null;
    try{
      const audit=prepareFreshExport(format);
    renderSMHDetail();renderExcessShortfall();
      await new Promise(resolve=>setTimeout(resolve,200));
      const availablePages=tableOnly?tablePages:pages;
      const chosen=which==='all'?availablePages:(availablePages.some(p=>p[0]===which)?availablePages.filter(p=>p[0]===which):[[which,which]]);
      const reports=chosen.map(p=>capture(p[0],{tableOnly}));
      if(tableOnly&&!reports.some(report=>report.tables.length))throw new Error('No visible table is available for this report.');
      const meta=viewMeta(which,reports[0],audit);
      const safeTitle=reports[0].title.replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,'');
      const suffix=currentView?'_current_view_':tableOnly?'_page_data_':'_visible_view_';
      const name='NR_Zone_'+(root.NR_SELECTED_SCOPE?.code||'03')+'_' +safeTitle+suffix+new Date().toISOString().slice(0,10);
      if(format==='Excel')saveBlob(new Blob([await excel(reports,meta,root.ExcelJS,{cleanHeader})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name+'.xlsx');
      else if(format==='PDF')(await pdf(reports,meta,root.jspdf.jsPDF,await fonts(),{cleanHeader})).save(name+'.pdf');
      else await (await ppt(reports,meta,root.PptxGenJS,{tableOnly,cleanHeader})).writeFile({fileName:name+'.pptx'});
    }catch(e){showPortalNotice('Displayed export failed: '+e.message,'err');}
  }
  function init(){
    const box=document.getElementById('displayExportPages');
    if(box)box.innerHTML=tablePages.map(([id,title],i)=>`<tr><td>${i+1}. ${title}</td>${['Excel','PDF','PPT'].map(format=>`<td><button type="button" onclick="DisplayExport.run('${format}','${id}',{tableOnly:true})">${format==='PPT'?'PowerPoint':format}</button></td>`).join('')}</tr>`).join('');
    pages.forEach(([id])=>{
      const section=document.getElementById('tab-'+id);
      if(section)section.querySelectorAll('.display-export-actions').forEach(bar=>bar.remove());
    });
  }
  async function configurePDF(doc){
    const loaded=await fonts();
    for(const [style,data] of Object.entries(loaded)){
      doc.addFileToVFS(style+'.ttf',data);
      for(const name of ['times','helvetica','TimesNewRoman'])doc.addFont(style+'.ttf',name,style);
    }
  }
  root.DisplayExport={pages,grid,bands,typed,capture,viewMeta,excel,pdf,ppt,run,init,configurePDF,fonts};
  if(typeof module!=='undefined')module.exports=root.DisplayExport;
})(typeof window!=='undefined'?window:globalThis);
