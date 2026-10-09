/* Shared browser/Node PDF generator. Uses current detail data, never cached totals. */
(function(root) {
  'use strict';
  const baseline = ['01','02','03','04','05','06','07','08','09','10','10N','11'];
  function varianceStyle(value) {
    if (value === null || Math.abs(value) < 1e-7) return {fillColor:[245,245,245],textColor:[60,60,60],fontStyle:'bold'};
    return value > 0
      ? {fillColor:[255,229,229],textColor:[160,20,20],fontStyle:'bold'}
      : {fillColor:[225,243,230],textColor:[20,100,45],fontStyle:'bold'};
  }
  function build(rows, months, kind) {
    const smhKey = r => String(r.smh).replace(/^SMH\s*-\s*/i,'').trim();
    const columns = [...new Set([...baseline, ...rows.map(smhKey)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const groups = new Map();
    for (const r of rows) {
      const code = kind === 'pu' ? r.puCode : r.deptCode;
      const name = kind === 'pu' ? r.puName : r.deptName;
      if (!groups.has(code)) groups.set(code, {code, name, cells:{}});
      const g = groups.get(code), key = smhKey(r);
      const cell = g.cells[key] || (g.cells[key] = {act:0,bp:0});
      cell.act += months.reduce((s,m)=>s+Number(r.months[m]||0),0);
      cell.bp += Number(r.budget||0)*months.length/12;
    }
    const list = [...groups.values()].sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true}));
    const total = {code:'TOTAL',name:'',cells:{}};
    for (const g of list) for (const [key,c] of Object.entries(g.cells)) {
      const t = total.cells[key] || (total.cells[key]={act:0,bp:0});
      t.act+=c.act; t.bp+=c.bp;
    }
    return {columns, groups:[...list,total]};
  }
  function generate(jsPDF, rows, months, meta, unit, fonts=null) {
    if (!['thousand','crore','dual'].includes(unit)) throw new Error('Invalid units');
    if (!rows.length) throw new Error('No department/SMH detail data available');
    meta={...meta,revision:(meta.scope?meta.scope+' | ':'')+meta.revision};
    const doc = new jsPDF({orientation:'landscape',unit:'pt',format:'a3'});
    if(fonts)for(const [style,data] of Object.entries(fonts)){
      doc.addFileToVFS(style+'.ttf',data);doc.addFont(style+'.ttf','helvetica',style);
    }
    const w=doc.internal.pageSize.getWidth(), h=doc.internal.pageSize.getHeight(), margin=36;
    const factor=unit==='crore'?10000:1;
    const fmt=v=>(Math.abs(v)<0.0000001?0:v/factor).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
    let page=0;
    function header(kind) {
      if(page++) doc.addPage();
      doc.setTextColor(0); doc.setFont('helvetica','bold'); doc.setFontSize(13);
      doc.text('NORTHERN RAILWAY - MORADABAD DIVISION',w/2,36,{align:'center'});
      doc.setFontSize(11);
      doc.text(kind==='pu'?'SMH WISE PRIMARY UNIT REPORT':'SMH WISE DEPARTMENT REPORT - ALL PRIMARY UNITS',w/2,53,{align:'center'});
      doc.setFont('helvetica','normal'); doc.setFontSize(10);
      doc.text(`FY ${meta.fy} | Completed through ${meta.through} | ${unit==='dual'?'Top: Rs thousands (10 pt); below: Rs crores (8 pt)':unit==='crore'?'Figures in Rs crores':'Figures in Rs thousands'}`,margin,72);
      doc.text('ACT: completed-month actual | BUD PROP: effective annual budget x completed months / 12 | VAR: ACT - BUD PROP',margin,88);
      doc.text('Scope: department detail dataset; department 00 and PU 72/73/74/75/98 excluded. Missing combinations shown as --.',margin,103);
      doc.text('VAR colours: red = above proportion; green = below proportion; grey = zero/missing. Colour uses unrounded values.',margin,118);
      doc.text(`Source revision: ${meta.revision} | Generated: ${meta.generated}`,margin,h-22);
      doc.text(`Page ${page}`,w-margin,h-22,{align:'right'});
    }
    for (const kind of ['pu','dept']) {
      const model=build(rows,months,kind);
      const widths={0:{cellWidth:170,halign:'left'},1:{cellWidth:70,halign:'left'}};
      const cw=(w-margin*2-240)/(model.columns.length+1);
      model.columns.forEach((_,i)=>widths[i+2]={cellWidth:cw});
      widths[model.columns.length+2]={cellWidth:cw};
      const head=[[{content:kind==='pu'?'PRIMARY UNITS':'DEPARTMENTS',colSpan:2}, {content:'SMHs',colSpan:model.columns.length+1}],['','',...model.columns,'TOTAL']];
      let y=h;
      for (const group of model.groups) {
        // Start a new sheet before a three-row PU/department block could split.
        const name=`${group.code}${group.name?' - '+group.name:''}`;
        const nameLines=doc.splitTextToSize(name,158).length;
        const required=Math.max(unit==='dual'?108:66,nameLines*12+12)+45;
        if(y+required>h-44) {
          header(kind);
          doc.autoTable({head,body:[],startY:129,margin:{left:margin,right:margin},styles:{fontSize:10,cellPadding:5,halign:'center',lineWidth:0.5,lineColor:0},headStyles:{fillColor:[190,190,190],textColor:0,fontStyle:'bold'},columnStyles:widths,theme:'grid'});
          y=doc.lastAutoTable.finalY;
        }
        const body=['act','bp','var'].map((metric,i)=>{
          const values=model.columns.map(key=>{
            const c=group.cells[key]; return c ? (metric==='act'?c.act:metric==='bp'?c.bp:c.act-c.bp) : null;
          });
          const label=['ACT','BUD PROP','VAR'][i];
          const cell = v => unit==='dual'
            ? {content:'',dual:{thousand:v===null?'--':fmt(v),crore:v===null?'--':(v/10000).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})},styles:metric==='var'?varianceStyle(v):{}}
            : metric==='var' ? {content:v===null?'--':fmt(v),styles:varianceStyle(v)} : (v===null?'--':fmt(v));
          return [...(i===0?[{content:name,rowSpan:3,styles:{halign:'left',valign:'middle'}}]:[]),metric==='var'?{content:label,styles:varianceStyle(0)}:label,...values.map(cell),cell(values.reduce((s,v)=>s+(v||0),0))];
        });
        doc.autoTable({body,startY:y,showHead:'never',pageBreak:'avoid',rowPageBreak:'avoid',margin:{left:margin,right:margin,bottom:44},theme:'grid',styles:{font:'helvetica',fontSize:10,cellPadding:5,halign:'right',textColor:0,lineColor:0,lineWidth:0.4,minCellHeight:unit==='dual'?36:22,overflow:'linebreak'},columnStyles:widths,
          didDrawCell:data=>{
            const dual=data.cell.raw?.dual;if(!dual)return;
            doc.setFont('helvetica',data.cell.styles.fontStyle||'normal');
            doc.setTextColor(...(Array.isArray(data.cell.styles.textColor)?data.cell.styles.textColor:[0,0,0]));
            const x=data.cell.x+data.cell.width-5;
            doc.setFontSize(10);doc.text(dual.thousand,x,data.cell.y+14,{align:'right'});
            doc.setFontSize(8);doc.text(dual.crore,x,data.cell.y+27,{align:'right'});
          }
        });
        y=doc.lastAutoTable.finalY;
      }
    }
    return doc;
  }
  root.SMHMatrixExport={build,generate,varianceStyle};
  if(typeof module!=='undefined') module.exports=root.SMHMatrixExport;
})(typeof window!=='undefined'?window:globalThis);
