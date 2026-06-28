/* Mock data + shared ECharts dark theme for the Oakville / 167 Events mockups.
   All data here is FAKE but shaped to match the real dataset magnitudes
   (39.4k shifts, 295 people, 165 weeks, 281k hours). No emojis. */

const C = {
  bg:'#0a0e13', panel:'#131a23', border:'#232e3a', grid:'#1c2733',
  text:'#e6edf3', text2:'#9aa7b4', text3:'#6b7886',
  accent:'#2dd4bf', accent2:'#4c8dff', amber:'#f5b14c',
  violet:'#a78bfa', pink:'#f472b6', green:'#34d399', red:'#f87171'
};

/* deterministic pseudo-random so mockups look stable across reloads */
let _seed = 1337;
function rnd(){ _seed = (_seed*9301 + 49297) % 233280; return _seed/233280; }
function rint(a,b){ return Math.floor(a + rnd()*(b-a+1)); }
function pick(arr){ return arr[Math.floor(rnd()*arr.length)]; }

const FIRST = ['Daniel','Natalia','Timothy','Kristen','Mylon','Jesus','Ulises','David','Maria',
  'Andre','Sofia','Marcus','Elena','Hassan','Priya','Liam','Noah','Ava','Diego','Camila',
  'Owen','Mateo','Isla','Ruby','Theo','Nina','Cole','Jade','Felix','Mara'];
const LAST = ['Morales','Hernandez','Christopher','Moon','Blackmore','Garcia','Chavez','Galloway',
  'Reyes','Nguyen','Patel','Okafor','Rossi','Kim','Santos','Vega','Brennan','Acosta','Lund',
  'Mercer','Dalton','Frost','Ibrahim','Castille','Romano','Park','Vance','Cruz','Webb','Hale'];

const JOBS_FOH = ['Server','Busser','Runner','Bar','Captain','Host','Wine Sommelier'];
const JOBS_BOH = ['Line Cook','Prep Cook','Dishwasher','Pastry','Steward-Receiver','Lead Line Cook'];
const SHIFTS = ['AM','PM','167'];

function nameFor(i){ return `${LAST[i%LAST.length]}, ${FIRST[i%FIRST.length]} ${String.fromCharCode(65+(i%26))}`; }

/* People with realistic spread */
const PEOPLE = Array.from({length:42}, (_,i)=>{
  const foh = rnd()>0.42;
  const job = foh ? pick(JOBS_FOH) : pick(JOBS_BOH);
  const tenure = rint(40, 1154);
  const shifts = Math.max(6, Math.round(tenure*rnd()*0.55));
  const hours = Math.round(shifts*(6+rnd()*3));
  const active = rnd()>0.32;
  const pm = Math.round(shifts*(0.25+rnd()*0.5));
  const am = Math.round((shifts-pm)*(0.6+rnd()*0.4));
  const t167 = Math.max(0, shifts-pm-am);
  return {
    name: nameFor(i), job, foh, tenure, shifts, hours, active,
    am, pm, t167,
    friSatPm: Math.round(pm*(0.3+rnd()*0.4)),
    streakWorked: rint(4,16), streakOff: rint(3,28),
    first: 1154-tenure, last: active? rint(1130,1154): rint(tenure, 1100)
  };
});

/* 165-week trend series */
function weeklySeries(base, amp, drift){
  return Array.from({length:165}, (_,w)=>{
    const seasonal = Math.sin(w/8)*amp*0.4;
    const trend = drift*w;
    const noise = (rnd()-0.5)*amp*0.5;
    return Math.max(0, Math.round(base + seasonal + trend + noise));
  });
}
const WEEK_LABELS = Array.from({length:165}, (_,w)=>{
  const d = new Date(2023,3,20); d.setDate(d.getDate()+w*7);
  return d.toISOString().slice(0,10);
});

/* ECharts shared dark theme */
const ECHART_BASE = {
  textStyle:{ fontFamily:'Inter, system-ui, sans-serif', color:C.text2 },
  grid:{ left:48, right:18, top:28, bottom:34, containLabel:true },
  tooltip:{
    backgroundColor:'#0d141c', borderColor:C.border, borderWidth:1,
    textStyle:{ color:C.text, fontSize:12 },
    axisPointer:{ lineStyle:{color:C.border2||'#2c3a48'}, crossStyle:{color:'#2c3a48'} }
  },
  legend:{ textStyle:{color:C.text2}, inactiveColor:C.text3, top:0, right:0, icon:'roundRect', itemWidth:9, itemHeight:9 }
};
function axisLine(){ return { lineStyle:{color:C.border} }; }
function splitLine(){ return { lineStyle:{color:C.grid} }; }

function catAxis(data, opt={}){ return Object.assign({
  type:'category', data, boundaryGap:opt.boundaryGap!==false,
  axisLine:axisLine(), axisTick:{show:false},
  axisLabel:{ color:C.text3, fontSize:11, ...(opt.axisLabel||{}) },
  splitLine:{show:false}
}, opt.extra||{}); }

function valAxis(opt={}){ return Object.assign({
  type:'value', axisLine:{show:false}, axisTick:{show:false},
  axisLabel:{ color:C.text3, fontSize:11, ...(opt.axisLabel||{}) },
  splitLine:splitLine()
}, opt.extra||{}); }

/* gradient helper */
function grad(c1,c2){ return new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:c1},{offset:1,color:c2}]); }
function areaGrad(c){ return new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:c+'66'},{offset:1,color:c+'02'}]); }
