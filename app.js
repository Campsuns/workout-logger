// ==== CONFIG – paste your Apps Script Web App URL + token ====
const CONFIG = {
  API_URL: 'PASTE_WEB_APP_URL_HERE', // https://script.google.com/macros/s/XXXXX/exec
  TOKEN: 'PASTE_API_TOKEN_HERE',
  WEEK_START: 1,
  REP_MIN: 6,
  REP_MAX: 12,
  DEFAULT_INC_LB: 5,
  DONE_TTL_HOURS: 8
};

// ==== State ====
let state = { exercises: [], splits: [], logs: [], byId: {}, currentSplit: '', period: 'week', eq: '', mg: '', page: 'list' };

// Persist/restore UI
const store = {
  get(){ try { return JSON.parse(localStorage.getItem('uiState')||'{}'); } catch{ return {}; } },
  set(part){ const cur = store.get(); localStorage.setItem('uiState', JSON.stringify({...cur, ...part})); }
};

// Keep session fresh every 10 min and on resume
setInterval(()=>{ if(document.visibilityState==='visible') fetchAll(); }, 10*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') fetchAll(); });

// ==== Helpers ====
const $ = (q, root=document)=>root.querySelector(q);
const $$ = (q, root=document)=>Array.from(root.querySelectorAll(q));
const vibrate = ms => (navigator.vibrate ? navigator.vibrate(ms) : null);
const toast = (msg)=>{ const t=$('#toast'); t.textContent=msg; t.hidden=false; setTimeout(()=>t.hidden=true, 1800); };
function fmt(num){ return Number(num||0).toFixed(0); }
function today(){ const d=new Date(); return d.toISOString().slice(0,10); }
function startOfPeriod(period){ const d=new Date(); if(period==='week'){ const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d; } if(period==='month'){ return new Date(d.getFullYear(), d.getMonth(), 1); } if(period==='year'){ return new Date(d.getFullYear(), 0, 1); } }
function inPeriod(dt, p){ const s=startOfPeriod(p); return new Date(dt) >= s; }
function e1rm(weight, reps){ return Number(weight)*(1+Number(reps)/30); }

function musclesOf(e){ return [e.primary, e.secondary, e.tertiary].filter(Boolean); }
function uniqueMuscles(list){ return [...new Set(list.flatMap(musclesOf).filter(Boolean))].sort(); }

// Done markers (8h TTL)
function markDone(exId){ const map = JSON.parse(localStorage.getItem('doneMap')||'{}'); map[exId] = Date.now(); localStorage.setItem('doneMap', JSON.stringify(map)); }
function isDone(exId){ const map = JSON.parse(localStorage.getItem('doneMap')||'{}'); const ts = map[exId]; if(!ts) return false; const ageH = (Date.now()-ts)/(1000*60*60); return ageH < CONFIG.DONE_TTL_HOURS; }

// Latest per-ex session (new schema: per workout)
function latestFor(exId){
  const exLogs = state.logs.filter(l=>l.exercise_id===exId);
  if(!exLogs.length) return null;
  exLogs.sort((a,b)=> new Date(b.date||b.timestamp) - new Date(a.date||a.timestamp));
  return exLogs[0];
}

function suggestNext(exId){
  // Uses last session's rpe_set2 and fail_last, with 6–12 rep range and +5 lb increments
  const ex = state.byId[exId]; if(!ex) return {weight:0, reps:8, sets:3, height:0};
  const last = latestFor(exId);
  const inc = Number(ex.increment_lb||CONFIG.DEFAULT_INC_LB||5);
  const minr=CONFIG.REP_MIN, maxr=CONFIG.REP_MAX; const midpoint = Math.floor((minr+maxr)/2);

  if(!last) return {weight:Number(ex.default_weight||0), reps:Math.max(minr,8), sets:Number(ex.sets||3), height:Number(ex.default_height||0)};

  let nextW = Number(last.weight_lb||ex.default_weight||0);
  let nextR = Number(last.planned_reps||8);
  const rpe = Number(last.rpe_set2||8);
  const failed = String(last.fail_last).toLowerCase()==='true' || last.fail_last===true || last.fail_last===1;

  if(rpe <= 7.5){
    if(nextR >= midpoint){ nextW += inc; nextR = Math.max(minr, midpoint-1); }
    else { nextR = Math.min(maxr, nextR+1); }
  } else if(rpe <= 8.5){
    nextR = Math.min(maxr, nextR+1);
  } else { // rpe >= 9
    if(failed && Number(last.planned_reps||0) < minr){ nextW = Math.max(0, nextW - inc); nextR = Math.max(minr, midpoint); }
    else { nextR = Math.max(minr, midpoint); }
  }

  if(nextR >= maxr && rpe <= 7.5){ nextW += inc; nextR = Math.max(minr, midpoint); }

  // Optional deload: if two hard sessions in a row (rpe >=9 + reps < min)
  const exLogs = state.logs.filter(l=>l.exercise_id===exId).sort((a,b)=> new Date(b.date||b.timestamp)-new Date(a.date||a.timestamp));
  const two = exLogs.slice(0,2);
  let hardCount=0;
  for(const s of two){
    const rp = Number(s.rpe_set2||0);
    const pr = Number(s.planned_reps||0);
    if(rp>=9 && pr<minr) hardCount++;
  }
  if(hardCount===2){ nextW = Math.round(nextW*0.95/inc)*inc; }

  return {weight: Math.max(0, Math.round(nextW)), reps: nextR, sets: Number(ex.sets||3), height: Number(last.height||ex.default_height||0)};
}

function rankImprovements(period){
  const logs = state.logs.filter(l=>inPeriod(l.date||l.timestamp, period));
  const byEx = new Map();
  for(const l of logs){
    const t = new Date(l.timestamp||l.date);
    const v = e1rm(l.weight_lb||0, l.planned_reps||0);
    const a = byEx.get(l.exercise_id)||[]; a.push({t,v}); byEx.set(l.exercise_id,a);
  }
  const out=[]; const now=new Date(); const start=startOfPeriod(period);
  for(const [ex, arr] of byEx.entries()){
    arr.sort((a,b)=>a.t-b.t);
    const startVal = (arr.find(x=>x.t>=start)||arr[0]||{}).v||0;
    const endVal = (arr.filter(x=>x.t<=now).slice(-1)[0]||{}).v||0;
    out.push({exercise_id: ex, delta: endVal-startVal});
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
  // Avoid preflight by sending JSON via POST without custom headers (Apps Script accepts it)
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action); url.searchParams.set('token', CONFIG.TOKEN);
  const res = await fetch(url, { method:'POST', body: JSON.stringify(payload) });
  return res.json();
}

async function fetchAll(){
  const data = await apiGet({action:'getAll'});
  if(data.error){ console.error(data.error); toast('API error: '+data.error); return; }
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
  const page = btn.dataset.nav; state.page = page; store.set({page}); $('#page-'+page).classList.add('active');
}));

// Restore nav + period + filters
(function restoreUI(){
  const s = store.get();
  if(s.page){ state.page = s.page; $$('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===s.page)); $$('.page').forEach(p=>p.classList.remove('active')); $('#page-'+s.page).classList.add('active'); }
  if(s.period){ state.period=s.period; $$('.period-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.period===s.period)); }
  if(s.split){ state.currentSplit=s.split; }
  if(s.eq!==undefined){ state.eq=s.eq; }
  if(s.mg!==undefined){ state.mg=s.mg; }
})();

$$('.period-tabs button').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.period-tabs button').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  state.period = btn.dataset.period; store.set({period: state.period}); renderSummary();
}));

// ==== UI: Filters & list ====
function renderFilters(){
  const splitSel = $('#splitSelect');
  const splits = [...new Set(state.splits.map(s=>s.split_name))];
  splitSel.innerHTML = `<option value="">All</option>` + splits.map(s=>`<option>${s}</option>`).join('');
  splitSel.value = state.currentSplit||'';
  splitSel.onchange = ()=>{ state.currentSplit = splitSel.value; store.set({split: state.currentSplit}); renderList(); };

  const equipments = [...new Set(state.exercises.map(e=>String(e.equipment||'').toLowerCase()).filter(Boolean))].sort();
  const muscles = uniqueMuscles(state.exercises);
  $('#equipmentFilter').innerHTML = `<option value="">Equipment</option>` + equipments.map(x=>`<option>${x}</option>`).join('');
  $('#muscleFilter').innerHTML = `<option value="">Muscle</option>` + muscles.map(x=>`<option>${x}</option>`).join('');
  $('#equipmentFilter').value = state.eq||''; $('#muscleFilter').value = state.mg||'';
  $('#equipmentFilter').onchange = ()=>{ state.eq = $('#equipmentFilter').value; store.set({eq: state.eq}); renderList(); };
  $('#muscleFilter').onchange = ()=>{ state.mg = $('#muscleFilter').value; store.set({mg: state.mg}); renderList(); };

  $('#btnAddExercise').onclick = ()=> $('#addModal').showModal();
}

function makeCardHTML(e){
  const sugg = suggestNext(e.id);
  const subSetup = [e.equipment, (sugg.height>0 ? `Height ${fmt(sugg.height)}` : '')].filter(Boolean).join(' • ');
  const subPlan = `${fmt(sugg.reps)} reps × ${fmt(sugg.sets)}`;
  const done = isDone(e.id);
  return `<div class="card ${done?'done':''}" data-id="${e.id}">
    <div>
      <div class="name">${e.name}</div>
      <div class="meta">${subSetup||' '}</div>
      <div class="plan">${subPlan}</div>
    </div>
    <div class="pill">${fmt(sugg.weight)} lb</div>
  </div>`;
}

function renderList(){
  const eq = (state.eq||'').toLowerCase();
  const mg = state.mg;

  const wrapSel = $('#selectedSplitWrap');
  const listSel = $('#selectedSplitList');
  const otherWrap = $('#otherWrap');
  const otherTitle = $('#otherTitle');
  const otherList = $('#workoutList');

  // Base items
  let items = state.exercises.slice();
  if(eq) items = items.filter(e=>String(e.equipment).toLowerCase()===eq);
  if(mg) items = items.filter(e=>musclesOf(e).includes(mg));

  if(state.currentSplit){
    const splitRows = state.splits.filter(s=>s.split_name===state.currentSplit).sort((a,b)=>Number(a.order)-Number(b.order));
    const splitIds = splitRows.map(r=>r.exercise_id);
    const top = splitIds.map(id=>items.find(e=>e.id===id)).filter(Boolean);
    const rest = items.filter(e=>!splitIds.includes(e.id));
    wrapSel.hidden = false;
    listSel.innerHTML = top.map(makeCardHTML).join('');
    otherTitle.hidden = false;
    otherList.innerHTML = rest.map(makeCardHTML).join('');
  } else {
    wrapSel.hidden = true;
    otherTitle.hidden = true;
    otherList.innerHTML = items.map(makeCardHTML).join('');
  }

  // Wire clicks
  $$('#workoutList .card, #selectedSplitList .card').forEach(c=>c.addEventListener('click',()=>openLog(c.dataset.id)));
}

// ==== Modal & logging ====
let modal, stepVals, curEx;
function openLog(exId){
  curEx = state.byId[exId]; if(!curEx) return;
  modal = $('#logModal');
  $('#logTitle').textContent = curEx.name;
  $('#logSub').textContent = [curEx.variation, musclesOf(curEx).join('/'), curEx.equipment].filter(Boolean).join(' • ');

  const sugg = suggestNext(exId);
  stepVals = { sets_done: Number(curEx.sets||3), planned_reps: sugg.reps||8, weight_lb: sugg.weight||0, height: sugg.height||0, fail_last: false, rpe_set2: 8 };
  $$('.stack .stepper').forEach(bindStepper);
  $('#logNotes').value = '';
  modal.showModal();
}

function bindStepper(node){
  const field = node.dataset.field; const span = $('span', node) || node;
  const up=$('.up', node), dn=$('.down', node), tg=$('.toggle', node);
  const render=()=>{ if(span) span.textContent = (field==='fail_last'? (stepVals.fail_last?'Yes':'No') : fmt(stepVals[field])); };
  render();
  if(up) up.onclick=()=>{ stepVals[field] = Number(stepVals[field]||0) + (field==='weight_lb'? Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB):1); render(); };
  if(dn) dn.onclick=()=>{ stepVals[field] = Math.max(0, Number(stepVals[field]||0) - (field==='weight_lb'? Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB):1)); render(); };
  if(tg) tg.onclick=()=>{ stepVals.fail_last=!stepVals.fail_last; tg.textContent = stepVals.fail_last?'Yes':'No'; };
}

$('#btnLog').addEventListener('click', async (e)=>{
  e.preventDefault();
  $('#btnLog').disabled = true;
  const payload = {
    timestamp: new Date().toISOString(),
    date: today(),
    exercise_id: curEx.id,
    sets_done: Number(stepVals.sets_done),
    planned_reps: Number(stepVals.planned_reps),
    weight_lb: Number(stepVals.weight_lb),
    height: Number(stepVals.height||0),
    rpe_set2: Number(stepVals.rpe_set2),
    fail_last: !!stepVals.fail_last,
    notes: $('#logNotes').value||''
  };
  try{
    const res = await apiPost('addLog', payload);
    if(res && !res.error){
      vibrate(30); toast('Logged ✅'); $('#checkPop').classList.add('show'); setTimeout(()=>$('#checkPop').classList.remove('show'), 600);
      modal.close(); markDone(curEx.id); fetchAll();
    } else { toast('Error: '+(res.error||'unknown')); }
  } catch(err){ toast('Network error'); }
  finally{ $('#btnLog').disabled = false; }
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

  const weights = {primary:3, secondary:2, tertiary:1};
  const score = new Map();
  for(const l of logs){
    const ex = state.byId[l.exercise_id]; if(!ex) continue;
    for(const [slot,w] of Object.entries(weights)){
      const m = (ex[slot]||'').trim(); if(!m) continue;
      score.set(m, (score.get(m)||0) + w);
    }
  }

  // Build muscle list universe from Exercises (include zeros)
  const allMuscles = uniqueMuscles(state.exercises);
  allMuscles.forEach(m=>{ if(!score.has(m)) score.set(m,0); });

  const ranked = [...score.entries()].sort((a,b)=>b[1]-a[1]);
  const muscles = ranked.slice(0,10);
  const neglected = ranked.slice(-5);

  const improved = rankImprovements(period).slice(0,5);
  const st = streaks(state.logs);

  wrap.innerHTML = `
    <div class="block"><h4 style="margin:0 0 6px">Streaks</h4>
      <div>Current: <b>${st.current}</b> weeks</div>
      <div>Best: <b>${st.best}</b> weeks</div>
      <div>Perfect weeks: <b>${st.perfectWeeks}</b></div>
    </div>
    <div class="block"><h4 style="margin:0 0 6px">Muscle Focus (${period})</h4>
      ${muscles.length? '<ol>'+muscles.map(([m,s])=>`<li>${m}: ${s}</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}
    </div>
    <div class="block"><h4 style="margin:0 0 6px">Most Neglected (${period})</h4>
      ${neglected.length? '<ol>'+neglected.map(([m,s])=>`<li>${m}: ${s}</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}
    </div>
    <div class="block"><h4 style="margin:0 0 6px">Most Improved (${period})</h4>
      ${improved.length? '<ol>'+improved.map(x=>`<li>${state.byId[x.exercise_id]?.name||x.exercise_id}: +${x.delta.toFixed(1)}</li>`).join('')+'</ol>':'<div class="meta">No data yet</div>'}
    </div>
  `;
}

// Startup
fetchAll();
