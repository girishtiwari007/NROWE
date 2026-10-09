// Run with node tools/test_calculations.cjs. No browser or data writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8').replace(/\r\n/g, '\n');
const payload={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/zone-au-data.js'),'utf8'),payload);const read=name=>JSON.parse(JSON.stringify(payload.window.NR_ZONE_DATA.scopes['03'][name==='BUDGET'?'budget':'month']));
let monthIndex = 5;
const months = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];
const ctx = vm.createContext({ BUDGET: read('BUDGET'), MONTH: read('MONTH'), PU_META: [],
  getMonthStatus: () => ({pastMonths: months.slice(0, monthIndex), curMonthKey: months[monthIndex], futureMonths: months.slice(monthIndex + 1)}) });
vm.runInContext(app.slice(app.indexOf('function isRGActive()'), app.indexOf('function fmtT(')), ctx);
vm.runInContext(app.slice(app.indexOf('function miniProg('), app.indexOf('function utilColor(')), ctx);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
function check(c) {
  near(c.curMonthTotal, c.curCommitted+c.curRemaining);
  near(c.balanceBudget, c.budget-c.totalCommitted);
  assert.ok(c.curRemaining>=0 && c.projPerMonth>=0);
  if(c.budget<0){near(c.curRemaining,0);near(c.projPerMonth,0);near(c.curMonthTotal,c.curCommitted);return;}
  if(c.budget<0){near(c.curRemaining,0);near(c.projPerMonth,0);near(c.curMonthTotal,c.curCommitted);return;}
  near(c.pastActuals+c.curMonthTotal+c.projPerMonth*c.remMonthCount, Math.max(c.budget,c.totalCommitted));
}
let count=0;
for (const code of Object.keys(ctx.BUDGET)) {
  if (code==='TOTAL' || ['72','73','74','75','98'].includes(code)) continue;
  check(ctx.compute(code)); count++;
}
assert.match(ctx.miniProg(1939.3, 'red'), /1939\.3%/);
assert.match(ctx.miniProg(1939.3, 'red'), /width:100%/);
for (const scenario of [
  {budget:1200,past:500,current:0,index:5,total:100,projection:100},
  {budget:1200,past:500,current:-30,index:5,total:100,projection:100},
  {budget:1200,past:500,current:300,index:5,total:300,projection:400/6},
  {budget:400,past:500,current:30,index:5,total:30,projection:0},
  {budget:0,past:0,current:30,index:0,total:30,projection:0},
  {budget:1200,past:1100,current:50,index:11,total:100,projection:0},
  {budget:1200,past:1100,current:200,index:11,total:200,projection:0},
]) {
  monthIndex=scenario.index;
  ctx.BUDGET={test:{bg_isl:scenario.budget,rg:0,actuals_till:scenario.past+scenario.current}};
  ctx.MONTH={test:{[months[monthIndex]]:scenario.current}};
  if (monthIndex>0) ctx.MONTH.test.apr=scenario.past;
  const c=ctx.compute('test'); check(c);
  near(c.curCommitted,scenario.current);
  near(c.curMonthTotal,scenario.total); near(c.projPerMonth,scenario.projection);
}
ctx.BUDGET = {
  revised:{bg_isl:1200,rg:900},
  original:{bg_isl:600,rg:0},
  blank:{bg_isl:400,rg:null},
  zeroGrant:{bg_isl:300,rg:0,rg_available:true},
  recovery:{bg_isl:-100,rg:-80},
  TOTAL:{bg_isl:2400,rg:820}
};
for (monthIndex = 0; monthIndex < 12; monthIndex++) {
  near(ctx.getBudget('revised'),900);
  near(ctx.getBudget('original'),600);
  near(ctx.getBudget('blank'),400);
  near(ctx.getBudget('zeroGrant'),0);
  near(ctx.getBudget('recovery'),-80);
  near(ctx.getBudget('TOTAL'),1820);
}
console.log(`PASS: ${count} operational source PUs, seven liability scenarios including signed running-month adjustments, and mixed RG/BG/zero/recovery selection across all 12 months.`);
