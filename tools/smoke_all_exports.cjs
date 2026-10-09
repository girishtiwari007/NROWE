// Execute real portal export functions with a minimal DOM, not browser automation.
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.export-validation');
fs.mkdirSync(out,{recursive:true});
const saved=[];
const ctx={console,Blob,TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,ArrayBuffer,Date,URL,atob,btoa,
 setTimeout:()=>0,setInterval:()=>0,clearTimeout:()=>{},
 localStorage:{getItem:()=>null,setItem:()=>{}},sessionStorage:{getItem:()=>null,setItem:()=>{}},
 navigator:{},location:{protocol:'http:',hostname:'localhost',search:''},
 document:{body:{dataset:{},classList:{add(){},remove(){},contains(){return false;}}},getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},
 addEventListener(){},confirm:()=>true,alert:console.log};
ctx.window=ctx;ctx.globalThis=ctx;ctx.crypto=require('crypto').webcrypto;
const os=require('os');
const bundledModules=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules');
const {createCanvas}=require(path.join(bundledModules,'@napi-rs','canvas'));
ctx.document.createElement=tag=>{if(tag==='canvas')return createCanvas(1,1);throw new Error('Unsupported test DOM element: '+tag);};
ctx.ExcelJS=require(path.join(root,'assets/vendor/exceljs.min.js'));
ctx.XLSX=require(path.join(root,'assets/vendor/xlsx.full.min.js'));
ctx.jspdf=require(path.join(root,'assets/vendor/jspdf.umd.min.js'));
const plugin={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/vendor/jspdf.plugin.autotable.min.js'),'utf8'),{module:plugin,exports:plugin.exports,require:()=>ctx.jspdf,console});
ctx.jspdf.jsPDF.API.save=function(name){fs.writeFileSync(path.join(out,name),Buffer.from(this.output('arraybuffer')));saved.push(name);return this;};
vm.createContext(ctx);
for(const file of ['detail-data.js','demand-smh-data.js']) vm.runInContext(fs.readFileSync(path.join(root,'assets/js',file),'utf8'),ctx);
let app=fs.readFileSync(path.join(root,'assets/js/app.js'),'utf8');
app=app.slice(0,app.lastIndexOf('// INIT'));
vm.runInContext(app,ctx);
ctx.confirmProtectedExport=()=>true;
ctx.renderAll=()=>{}; // UI repaint is outside this file-format test.
ctx.showPortalNotice=(message)=>{throw new Error(message);};
ctx.saveBlob=(blob,name)=>{saved.push(name);return blob.arrayBuffer().then(b=>fs.writeFileSync(path.join(out,name),Buffer.from(b)));};
(async()=>{
 await ctx.downloadExcel();
 await ctx.downloadPDFReport();
 await ctx.downloadPowerPoint();
 await new Promise(resolve=>setTimeout(resolve,100));
 console.log('GENERATED',saved);
 if(!['.xlsx','.pdf','.pptx'].every(ext=>saved.some(n=>n.endsWith(ext)))) throw new Error('Not all exports generated');
})().catch(e=>{console.error(e);process.exitCode=1;});
