// Local-only, two-year NR sync. Validate both builds before publishing either.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),vm=require('vm'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),config=JSON.parse(fs.readFileSync(path.join(root,'tools/nr-source-config.json'),'utf8'));
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'nr-zone-sync-'));
const years=[config.currentYear,config.previousYear],outputs=['zone-au-data.js','zone-au-py-data.js'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
try{
 const datasets=[],sources=[];
 for(let i=0;i<years.length;i++){
  const result=cp.spawnSync(process.execPath,[path.join(root,'tools/sync_nr_zone.cjs'),root,stage,years[i]],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||result.stdout||'Build failed');
  const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(stage,'assets/js',outputs[i]),'utf8'),context);datasets.push(context.window[i?'NR_ZONE_PY_DATA':'NR_ZONE_DATA']);
  for(const name of [...config.years[years[i]].zone,...config.years[years[i]].au]){const relativePath=path.join('data/mb-budget-sync/source-files',years[i],name),buffer=fs.readFileSync(path.join(root,relativePath));sources.push({fy:years[i],name,relativePath:relativePath.replace(/\\/g,'/'),sha256:hash(buffer),size:buffer.length});}
 }
 const now=new Date().toISOString(),revision=hash(JSON.stringify(sources)+fs.readFileSync(path.join(root,'tools/sync_nr_zone.cjs'),'utf8')).slice(0,12),auditDir=path.join(root,'data/mb-budget-sync/nr-history'),previousManifestPath=path.join(root,'data/mb-budget-sync/sync-manifest.json');
 fs.mkdirSync(auditDir,{recursive:true});
 const manifest={ok:true,mode:'nr-zone-local-sync',targetRepo:root,generatedAt:now,sourceRevision:revision,assetVersion:'nr-'+revision,financialYear:config.currentYear,previousYear:config.previousYear,reportingCurrentMonthIdx:datasets[0].reportingCurrentMonthIdx,sources,sourceFiles:sources,scopes:Object.keys(datasets[0].scopes),previousYearScopes:Object.keys(datasets[1].scopes),calculationValidation:{ok:true,rule:'PU source controls reconciled for annual budget and all twelve months; rounding residuals retained.'},warnings:datasets.flatMap(d=>Object.values(d.scopes).filter(s=>s.coverage.includes(false)||s.warnings?.length).map(s=>({fy:d.financialYear,scope:s.code,coverage:s.coverage,warnings:s.warnings||[]})))};
 // Retain a scoped recovery snapshot; never copy to or contact another repository.
 const snap=path.join(auditDir,now.replace(/[:.]/g,'-')+'-'+revision);fs.mkdirSync(snap);
 for(const file of outputs){const live=path.join(root,'assets/js',file);if(fs.existsSync(live))fs.copyFileSync(live,path.join(snap,'before-'+file));}
 if(fs.existsSync(previousManifestPath))fs.copyFileSync(previousManifestPath,path.join(snap,'before-manifest.json'));
 for(const file of outputs){const live=path.join(root,'assets/js',file);fs.copyFileSync(path.join(stage,'assets/js',file),live+'.tmp');fs.renameSync(live+'.tmp',live);fs.copyFileSync(live,path.join(snap,file));}
 fs.writeFileSync(path.join(snap,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(previousManifestPath,JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(root,'data/mb-budget-sync/sync-log.json'),JSON.stringify({ok:true,generatedAt:now,sourceRevision:revision,mode:manifest.mode,scopes:manifest.scopes,warnings:manifest.warnings},null,2)+'\n');
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8');html=html.replace(/(assets\/js\/(?:zone-au-data|zone-au-py-data)\.js\?v=)[^"']+/g,'$1'+manifest.assetVersion);fs.writeFileSync(path.join(root,'index.html'),html);
 console.log(JSON.stringify({ok:true,mode:manifest.mode,currentYear:config.currentYear,previousYear:config.previousYear,scopes:manifest.scopes.length,sources:sources.length,revision,warnings:manifest.warnings.length},null,2));
}finally{
 // Only the concrete temporary directory created above is removed.
 const relative=path.relative(os.tmpdir(),stage);if(relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(stage).startsWith('nr-zone-sync-'))throw new Error('Unsafe temporary cleanup path');
 fs.rmSync(stage,{recursive:true,force:true});
}
