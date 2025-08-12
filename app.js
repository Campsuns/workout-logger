// ==== CONFIG – paste your Apps Script Web App URL + token ====
const CONFIG = {
  API_URL: 'PASTE_WEB_APP_URL_HERE', // e.g., https://script.google.com/macros/s/XXXXX/exec
  TOKEN: 'PASTE_API_TOKEN_HERE',
  WEEK_START: 1, // Monday
  REP_MIN: 6,
  REP_MAX: 12,
  DEFAULT_INC_LB: 5,
};

// ==== State ====
let state = { exercises: [], splits: [], logs: [], byId: {}, currentSplit: '', period: 'week' };

// Keep session active-ish: refresh every 10 min and on resume
setInterval(()=>{ if(document.visibilityState==='visible') fetchAll(); }, 10*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') fetchAll(); });

// ==== Helpers ====
const $ = (q, root=document)=>root.querySelector(q);
const $$ = (q, root=document)=>Array.from(root.querySelectorAll(q));
const vibrate = ms => (navigator.vibrate ? navigator.vibrate(ms) : null);

function fmt(num){ return Number(num||0).toFixed(0); }
function today(){ const d=new Date(); return d.toISOString().slice(0,10); }
function startOfPeriod(period){
  const d=new Date();
  if(period==='week'){
    const day=(d.getDay()+6)%7; // Mon=0
    d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d;
  }
  if(period==='month'){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  if(period==='year'){ return new Date(d.getFullYear(), 0, 1); }
}
function inPeriod(dt, p){ const s=startOfPeriod(p); return new Date(dt) >= s; }
function e1rm(weight, reps){ return Number(weight)*(1+Number(reps)/30); }

function getMuscles(e){ return [e.primary, e.secondary, e.tertiary].filter(Boolean); }
function allMuscles(list){ return [...new Set(list.flatMap(getMuscles).filter(Boolean))].sort(); }

function groupLogsBySession(logs){
  // Group by exercise_id + date (session day)
  const map = new Map();
  for(const l of logs){
    const key = `${l.exercise_id}__${l.date}`;
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  }
  return map;
}

function latestSessionFor(exId){
  const exLogs = state.logs.filter(l=>l.exercise_id===exId);
  if(!exLogs.length) return null;
  exLogs.sort((a,b)=> new Date(b.date||b.timestamp) - new Date(a.date||a.timestamp));
  const lastDate = exLogs[0].date;
  return exLogs.filter(l=>l.date===lastDate);
}

function suggestNext(exId){
  // Uses RPE from set 2 and Fail on last set in the **latest session** for that exercise
  const ex = state.byId[exId]; if(!ex) return {weight:0, reps:8};
  const sess = latestSessionFor(exId);
  if(!sess) return {weight: Number(ex.default_weight||0), reps: Math.max(CONFIG.REP_MIN, 8)};

  const set2 = sess.find(l=>Number(l.set_number)===2) || sess[0];
  const last = sess.find(l=>Number(l.set_number)===Number(ex.sets)) || sess[sess.length-1];
  const rpe = Number(set2?.rpe||8);
  const reps2 = Number(set2?.reps||8);
  const lastReps = Number(last?.reps||0);
  const failed = String(last?.fail).toLowerCase()==='true' || last?.fail===true || last?.fail===1;
  const inc = Number(ex.increment_lb||CONFIG.DEFAULT_INC_LB||5);
  const minr=CONFIG.REP_MIN, maxr=CONFIG.REP_MAX; const midpoint = Math.floor((minr+maxr)/2);
  let nextW = Number(last.weight_lb||ex.default_weight||0), nextR = reps2;

  if(rpe <= 7.5){
    if(nextR >= midpoint){ nextW += inc; nextR = Math.max(minr, midpoint-1); }
    else { nextR = Math.min(maxr, nextR+1); }
  } else if(rpe <= 8.5){
    nextR = Math.min(maxr, nextR+1);
  } else { // rpe >= 9
    if(failed && lastReps < minr){ nextW = Math.max(0, nextW - inc); nextR = Math.max(minr, midpoint); }
    else { nextR = Math.max(minr, midpoint); }
  }

  if(nextR >= maxr && rpe <= 7.5){ nextW += inc; nextR = Math.max(minr, midpoint); }

  // Auto-deload if two consecutive hard fails
  const exLogs = state.logs.filter(l=>l.exercise_id===exId).sort((a,b)=> new Date(b.date||b.timestamp)-new Date(a.date||a.timestamp));
  const lastTwoSessions = groupLogsBySession(exLogs);
  const keys = [...lastTwoSessions.keys()].sort().slice(-2);
  let hardCount=0;
  for(const k of keys){
    const arr = lastTwoSessions.get(k).sort((a,b)=>Number(a.set_number)-Number(b.set_number));
    const lastSet = arr.find(l=>Number(l.set_number)===Number(ex.sets)) || arr[arr.length-1];
    if(Number(lastSet?.rpe||0)>=9 && Number(lastSet?.reps||0)<minr) hardCount++;
  }
  if(hardCount===2){ nextW = Math.round(nextW*0.95/inc)*inc; }

  return {weight: Math.max(0, Math.round(nextW)), reps: nextR};
}

function rankImprovements(period){
  const logs = state.logs.filter(l=>inPeriod(l.date||l.timestamp, period));
  const byEx = new Map();
  for(const l of logs){
    const t = new Date(l.timestamp||l.date);
    const v = e1rm(l.weight_lb||0, l.reps||0);
    const a = byEx.get(l.exercise_id)||[]; a.push({t,v}); byEx.set(l.exercise_id,a);
  }
  const out=[]; const now=new Date(); const start=startOfPeriod(period);
  for(const [ex, arr] of byEx.entries()){
    arr.sort((a,b)=>a.t-b.t);
    const startVal = (arr.find(x=>x.t>=start)||arr[0]||{}).v||0;
    const endVal = (arr.filter(x=>x.t<=now).slice(-1)[0]||{}).v||0;
    out.push({exercise_id: ex, delta: endVal-startVal, startVal, endVal});
  }
  out.sort((a,b)=>b.delta-a.delta);
  return out;
}

function streaks(logs){
  const map = new Map();
  for(const l of logs){
    const d = new Date(l.date||l.timestamp);
    const monday = new Date(d); const day=(d.getDay()+6)%7; monday.setDate(d.getDate()-day); monday.setHours(0,0,0,0);
    const key = monday.toISOString().slice(0,10);
    const dayKey = d.toDateString();
    if(!map.has(key)) map.set(key, new Set());
    map.get(key).add(dayKey);
  }
  const weeks = [...map.entries()].map(([wk, days])=>({week:wk, sessions: days.size})).sort((a,b)=>a.week.localeCompare(b.week));
  let cur=0,best=0,perfect=0; for(const w of weeks){ if(w.sessions>=3){cur++; best=Math.max(best,cur);} else cur=0; if(w.sessions>=5) perfect++; }
  return {current: cur, best, perfectWeeks: perfect};
}

// ==== API ====
async function apiGet(params){
  const url = new URL(CONFIG.API_URL);
  Object.entries({token: CONFIG.TOKEN, ...params}).forEach(([k,v])=>url.searchParams.set(k,v));
  const res = await fetch(url, { method:'GET' });
  return res.json();
}
async function apiPost(action, payload){
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', CONFIG.TOKEN);
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  return res.json();
}

async function fetchAll(){
  const data = await apiGet({action:'getAll'});
  if(data.error){ console.error(data.error); return; }
  state.exercises = data.exercises||[];
  state.splits = data.splits||[];
  state.logs = data.logs||[];
  state.byId = Object.fromEntries(state.exercises.map(e=>[e.id, e]));
  renderFilters();
  renderList();
  renderSummary();
}

// ==== UI: Nav ====
$$('[data-nav]').forEach(btn=>btn.addEventListener('click',()=>{
  $$('[data-nav]').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  $$('.page').forEach(p=>p.classList.remove('active'));
  $('#page-'+btn.dataset.nav).classList.add('active');
}));

$$('.period-tabs button').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.period-tabs button').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  state.period = btn.dataset.period; renderSummary();
}));

// ==== UI: Filters & list ====
function renderFilters(){
  const splitSel = $('#splitSelect');
  const splits = [...new Set(state.splits.map(s=>s.split_name))];
  splitSel.innerHTML = `<option value="">All</option>` + splits.map(s=>`<option>${s}</option>`).join('');
  splitSel.onchange = ()=>{ state.currentSplit = splitSel.value; renderList(); };

  const equipments = [...new Set(state.exercises.map(e=>String(e.equipment||'').toLowerCase()).filter(Boolean))].sort();
  const muscles = allMuscles(state.exercises);
  $('#equipmentFilter').innerHTML = `<option value="">All equipment</option>` + equipments.map(x=>`<option>${x}</option>`).join('');
  $('#muscleFilter').innerHTML = `<option value="">All muscles</option>` + muscles.map(x=>`<option>${x}</option>`).join('');
  $('#equipmentFilter').onchange = renderList; $('#muscleFilter').onchange = renderList;

  $('#btnAddExercise').onclick = ()=> $('#addModal').showModal();
}

function renderList(){
  const list = $('#workoutList');
  const eq = $('#equipmentFilter').value.toLowerCase();
  const mg = $('#muscleFilter').value;

  // If a split is selected, show split exercises first in order
  let items = state.exercises.slice();
  if(state.currentSplit){
    const splitRows = state.splits.filter(s=>s.split_name===state.currentSplit).sort((a,b)=>Number(a.order)-Number(b.order));
    const splitIds = splitRows.map(r=>r.exercise_id);
    const top = splitIds.map(id=>state.exercises.find(e=>e.id===id)).filter(Boolean);
    const rest = items.filter(e=>!splitIds.includes(e.id));
    items = [...top, ...rest];
  }

  if(eq) items = items.filter(e=>String(e.equipment).toLowerCase()===eq);
  if(mg) items = items.filter(e=>getMuscles(e).includes(mg));

  list.innerHTML = items.map(e=>{
    const sub = [e.variation, [e.primary,e.secondary,e.tertiary].filter(Boolean).join('/') , e.equipment].filter(Boolean).join(' • ');
    const sugg = suggestNext(e.id);
    return `<div class="card" data-id="${e.id}">
      <div>
        <div style="font-weight:700;margin-bottom:2px">${e.name}</div>
        <div class="meta">${sub}</div>
      </div>
      <div class="tag">${(sugg.weight||0)} lb × ${(sugg.reps||8)}</div>
    </div>`;
  }).join('');

  $$('#workoutList .card').forEach(c=>c.addEventListener('click',()=>openLog(c.dataset.id)));
}

// ==== Modal & logging ====
let modal, stepVals, curEx;
function openLog(exId){
  curEx = state.byId[exId]; if(!curEx) return;
  modal = $('#logModal');
  $('#logTitle').textContent = curEx.name;
  $('#logSub').textContent = [curEx.variation, [curEx.primary,curEx.secondary,curEx.tertiary].filter(Boolean).join('/'), curEx.equipment].filter(Boolean).join(' • ');
  const sugg = suggestNext(exId);
  stepVals = { set_number: 1, reps: sugg.reps||8, weight_lb: sugg.weight||0, height: curEx.default_height||0, fail: false, rpe: 8 };
  $$('.stepper').forEach(bindStepper);
  $('#logNotes').value = '';
  modal.showModal();
}

function bindStepper(node){
  const field = node.dataset.field; const span = $('span', node) || node;
  const up=$('.up', node), dn=$('.down', node), tg=$('.toggle', node);
  const render=()=>{ if(span) span.textContent = (field==='fail'? (stepVals.fail?'Yes':'No') : fmt(stepVals[field])); };
  render();
  if(up) up.onclick=()=>{ stepVals[field] = Number(stepVals[field]||0) + (field==='weight_lb'? Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB):1); render(); };
  if(dn) dn.onclick=()=>{ stepVals[field] = Math.max(0, Number(stepVals[field]||0) - (field==='weight_lb'? Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB):1)); render(); };
  if(tg) tg.onclick=()=>{ stepVals.fail=!stepVals.fail; tg.textContent = stepVals.fail?'Yes':'No'; };
}

$('#btnLog').addEventListener('click', async (e)=>{
  e.preventDefault();
  const payload = {
    timestamp: new Date().toISOString(),
    date: today(),
    exercise_id: curEx.id,
    set_number: Number(stepVals.set_number),
    reps: Number(stepVals.reps),
    weight_lb: Number(stepVals.weight_lb),
    height: Number(stepVals.height||0),
    rpe: Number(stepVals.rpe),
    fail: !!stepVals.fail,
    notes: $('#logNotes').value||''
  };
  const res = await apiPost('addLog', payload);
  if(res && !res.error){
    vibrate(30);
    $('#checkPop').classList.add('show'); setTimeout(()=>$('#checkPop').classList.remove('show'), 600);
    modal.close(); fetchAll();
  } else { alert('Error: '+(res.error||'unknown')); }
});

// ==== Add Exercise ====
$('#btnAddExercise')?.addEventListener('click', ()=> $('#addModal').showModal());
$('#btnSaveExercise')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  const id = 'ex_'+Math.random().toString(36).slice(2,8);
  const body = {
    id,
    name: $('#exName').value.trim(),
    variation: $('#exVar').value.trim(),
    primary: $('#exPri').value.trim(),
    secondary: $('#exSec').value.trim(),
    tertiary: $('#exTer').value.trim(),
    equipment: $('#exEq').value.trim().toLowerCase(),
    sets: Number($('#exSets').value||3),
    default_weight: Number($('#exW').value||0),
    default_height: Number($('#exH').value||0),
    increment_lb: $('#exInc').value.trim()
  };
  if(!body.name){ alert('Name required'); return; }
  const res = await apiPost('addExercise', body);
  if(res && !res.error){ $('#addModal').close(); fetchAll(); }
  else alert('Error: '+(res.error||'unknown'));
});

// ==== Summary ====
function renderSummary(){
  const wrap = $('#summaryContent');
  const period = state.period;
  const logs = state.logs.filter(l=>inPeriod(l.date||l.timestamp, period));

  // Weighted muscle focus (3/2/1)
  const weights = {primary:3, secondary:2, tertiary:1};
  const score = new Map();
  for(const l of logs){
    const ex = state.byId[l.exercise_id]; if(!ex) continue;
    for(const [slot,w] of Object.entries(weights)){
      const m = (ex[slot]||'').trim(); if(!m) continue;
      score.set(m, (score.get(m)||0) + w);
    }
  }
  const muscles = [...score.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);

  // Most improved (e1RM change within period)
  const improved = rankImprovements(period).slice(0,5);

  // Streaks
  const st = streaks(state.logs);

  wrap.innerHTML = `
    <div class="block"><h4 style="margin:0 0 6px">Muscle Focus (${period})</h4>
      ${muscles.length? '<ol>'+muscles.map(([m,s])=>`<li>${m}: ${s}</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}
    </div>
    <div class="block"><h4 style="margin:0 0 6px">Most Improved (${period})</h4>
      ${improved.length? '<ol>'+improved.map(x=>`<li>${state.byId[x.exercise_id]?.name||x.exercise_id}: +${x.delta.toFixed(1)} e1RM</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}
    </div>
    <div class="block"><h4 style="margin:0 0 6px">Streaks</h4>
      <div>Current ≥3/wk: <b>${st.current}</b> weeks</div>
      <div>Best ≥3/wk: <b>${st.best}</b> weeks</div>
      <div>Perfect weeks (≥5 sessions): <b>${st.perfectWeeks}</b></div>
    </div>
  `;
}

// Startup
fetchAll();
