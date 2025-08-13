// ==== CONFIG – paste your Apps Script Web App URL + token ====
// IMPORTANT: after unzipping, copy your existing API_URL and TOKEN
// values from your current app.js into CONFIG below.
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzQmuBTqcODPLJc2U1GhIgKEK_xaa0buIdC55mIWv1hg7QoXwyxe36tMNfjyl3HIWFKew/exec',
  TOKEN: 'n7V6p3kFQw9zL1r8U2y4T0bC5mA7',
  WEEK_START: 1,
  REP_MIN: 6,
  REP_MAX: 12,
  DEFAULT_INC_LB: 5,
  DONE_TTL_HOURS: 8,
};

// ==== State ====
let state = {
  users: [],
  userId: 'u_camp',                     // 'u_camp' | 'u_annie'
  exercises: [], splits: [], logs: [],  // data
  byId: {},                             // exercise id → record
  currentSplit: '',
  period: 'week',
  eq: '', mg: '',
  page: 'list',
};

// ==== Persist UI ====
const store = {
  get(){ try { return JSON.parse(localStorage.getItem('uiState')||'{}'); } catch(_) { return {}; } },
  set(part){ const cur = store.get(); localStorage.setItem('uiState', JSON.stringify({...cur, ...part})); }
};

// Keep data fresh on resume
setInterval(()=>{ if(document.visibilityState==='visible') fetchAll(); }, 10*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') fetchAll(); });

// DOM helpers
const $  = (q, root=document)=>root.querySelector(q);
const $$ = (q, root=document)=>Array.from(root.querySelectorAll(q));

// Prevent double-tap zoom inside the log modal (keeps pinch-zoom elsewhere)
(function(){
  let last=0;
  document.addEventListener('touchend', e=>{
    if (!$('#logModal')?.open) return;
    const now = Date.now();
    if (now - last < 300) e.preventDefault();
    last = now;
  }, { passive:false });
})();

// ==== Small helpers ====
function fmt(n){ return Number(n||0).toFixed(0); }
function today(){ const d=new Date(); return d.toISOString().slice(0,10); }
function startOfPeriod(period){
  const d=new Date();
  if(period==='week'){ const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d; }
  if(period==='month') return new Date(d.getFullYear(), d.getMonth(), 1);
  if(period==='year')  return new Date(d.getFullYear(), 0, 1);
  return d;
}
function inPeriod(dt, p){ const s=startOfPeriod(p); return new Date(dt)>=s; }
function e1rm(weight, reps){ return Number(weight)*(1+Number(reps)/30); }
function musclesOf(e){ return [e.primary,e.secondary,e.tertiary].filter(Boolean); }
function uniqueMuscles(list){ return [...new Set(list.flatMap(musclesOf).filter(Boolean))].sort(); }
function equipDisplay(lbl){
  const s = String(lbl||'').trim();
  if(!s) return 'Other';
  return s.replace(/\b\w/g,c=>c.toUpperCase())
          .replace(/\bEz\b/g,'EZ').replace(/\bV Bar\b/g,'V-Bar');
}
function markDone(exId){
  const map=JSON.parse(localStorage.getItem('doneMap')||'{}'); map[exId]=Date.now();
  localStorage.setItem('doneMap', JSON.stringify(map));
}
function isDone(exId){
  const map=JSON.parse(localStorage.getItem('doneMap')||'{}'); const ts=map[exId];
  if(!ts) return false; const ageH=(Date.now()-ts)/(1000*60*60); return ageH<CONFIG.DONE_TTL_HOURS;
}
function chooseSide(exId){ const s=JSON.parse(localStorage.getItem('lastSide')||'{}'); return s[exId]||'both'; }
function saveSide(exId, side){ const s=JSON.parse(localStorage.getItem('lastSide')||'{}'); s[exId]=side; localStorage.setItem('lastSide', JSON.stringify(s)); }

// ==== User scoping (strict) ====
// Exercises: ONLY the current user's exercises. No shared defaults.
function exercisesForUser(){
  const uid=state.userId;
  return state.exercises.filter(e => (e.owner||'').toLowerCase() === uid);
}
// Logs: ONLY the current user's logs.
function logsForUser(){
  const uid = state.userId;
  return state.logs.filter(l => (l.user_id || 'u_camp') === uid);
}

// ==== Latest log / Suggestion ====
function isSkip(l){ const v=String(l.skip_progress??'').toLowerCase(); return v==='1'||v==='true'||v==='yes'; }
function latestFor(exId, side){
  const want = String(side || 'both').toLowerCase();
  const norm = x => String(x || 'both').toLowerCase();
  const valid = logsForUser().filter(l => l.exercise_id===exId && !isSkip(l));
  if(!valid.length) return null;
  const same = valid.filter(l => norm(l.side)===want);
  const arr = same.length ? same : valid;
  arr.sort((a,b)=> new Date(b.timestamp||b.date) - new Date(a.timestamp||a.date));
  return arr[0] || null;
}
function suggestNext(exId, side){
  const ex = state.byId[exId]; 
  if(!ex) return { weight:Number(ex?.default_weight||0), reps:8, sets:Number(ex?.sets||3), height:Number(ex?.default_height||0) };
  const last = latestFor(exId, side);
  if(!last) return { weight:Number(ex.default_weight||0), reps:8, sets:Number(ex.sets||3), height:Number(ex.default_height||0) };

  let reps = Number(last.planned_reps||8);
  let wt   = Number(last.weight_lb||ex.default_weight||0);
  let h    = Number(last.height||ex.default_height||0);
  const fail = Number(last.fail_reps||reps);
  const rpe  = Number(last.rpe_set2||8);

  // Rep-first within 6–12 then +5 lb. Soft deload if struggle.
  if (fail >= reps && reps < CONFIG.REP_MAX && rpe <= 8) {
    reps++;
  } else if (reps >= CONFIG.REP_MAX && fail >= reps-1) {
    wt += CONFIG.DEFAULT_INC_LB;
    reps = Math.max(CONFIG.REP_MIN, 8);
  }
  if (fail <= Math.max(CONFIG.REP_MIN-1, reps-3) || rpe >= 9) {
    reps = Math.max(CONFIG.REP_MIN, reps-1);
  }
  return { weight: wt, reps, sets: Number(ex.sets||3), height: h };
}

// ==== Improvements / Streaks (use ONLY current user's logs) ====
function rankImprovements(period){
  const logs = logsForUser().filter(l=>inPeriod(l.date||l.timestamp, period));
  const byEx = new Map();
  for(const l of logs){
    const t=new Date(l.timestamp||l.date);
    const v=e1rm(l.weight_lb||0, l.planned_reps||0);
    const a=byEx.get(l.exercise_id)||[]; a.push({t,v}); byEx.set(l.exercise_id,a);
  }
  const out=[]; const start=startOfPeriod(period), now=new Date();
  for(const [id,arr] of byEx.entries()){
    arr.sort((a,b)=>a.t-b.t);
    const startVal=(arr.find(x=>x.t>=start)||arr[0]||{}).v||0;
    const endVal=(arr.filter(x=>x.t<=now).slice(-1)[0]||{}).v||0;
    out.push({id, delta:endVal-startVal});
  }
  out.sort((a,b)=>b.delta-a.delta); return out;
}
function streaks(){
  const allLogs = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  const weeks = new Map();
  for(const l of allLogs){
    const d=new Date(l.date||l.timestamp);
    const weekStart = new Date(d); weekStart.setDate(d.getDate()-((d.getDay()+6)%7)); weekStart.setHours(0,0,0,0);
    const key = weekStart.toISOString().slice(0,10);
    weeks.set(key, (weeks.get(key)||0)+1);
  }
  const keys=[...weeks.keys()].sort();
  let cur=0,best=0,perfect=0, prev=null;
  for(const k of keys){
    const idx = keys.indexOf(k);
    if(prev===null || idx===prev+1) cur++; else cur=1;
    if(weeks.get(k)>=5) perfect++;
    if(cur>best) best=cur;
    prev=idx;
  }
  return { current:cur, best, perfectWeeks:perfect };
}

// ==== API ====
async function apiGet(params){
  const url=new URL(CONFIG.API_URL);
  url.searchParams.set('token', CONFIG.TOKEN);
  Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k,v));
  const res=await fetch(url.toString(), {method:'GET'});
  return res.json();
}
async function apiPost(action, payload){
  const url=new URL(CONFIG.API_URL);
  url.searchParams.set('token', CONFIG.TOKEN);
  url.searchParams.set('action', action);
  const res=await fetch(url.toString(), {method:'POST', body: JSON.stringify(payload)});
  return res.json();
}

// ==== Fetch & boot ====
async function fetchAll(){
  const data = await apiGet({action:'getAll'});
  if(data.error){ console.error(data.error); toast('API error: '+data.error); return; }
  state.exercises = data.exercises||[];
  state.splits    = data.splits||[];
  state.logs      = data.logs||[];
  state.users     = (data.users && data.users.length) ? data.users : [{user_id:'u_camp',name:'Camp'},{user_id:'u_annie',name:'Annie'}];

  // Build map only from CURRENT user's exercises to avoid cross-user names in Summary
  state.byId = Object.fromEntries(exercisesForUser().map(e=>[e.id, e]));

  renderUserChips();
  renderFilters();
  renderList();
  renderSummary();
}

// Robust nav binding
function bindNav(){
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-nav]'); if(!btn) return;
    e.preventDefault();
    const page = btn.dataset.nav;           // 'list' or 'summary'
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b===btn));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');
    state.page = page; store.set({ page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, true);
}

// Restore UI
(function restoreUI(){
  const s=store.get();
  if(s.page) state.page=s.page;
  if(s.split!==undefined) state.currentSplit=s.split;
  if(s.period) state.period=s.period;
  if(s.eq!==undefined) state.eq=s.eq;
  if(s.mg!==undefined) state.mg=s.mg;
  if(s.userId) state.userId=s.userId;
})();

// Period tabs
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('.period-tabs button'); if(!btn) return;
  const wrap = btn.parentElement;
  wrap.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.period = btn.dataset.period || btn.textContent.toLowerCase();
  store.set({period: state.period});
  renderSummary();
});

// ==== Filters & chips ====
function renderUserChips(){
  const row = document.querySelector('#userRow');
  if(!row) return;
  const byId = Object.fromEntries((state.users||[]).map(u => [u.user_id, u.name]));
  row.querySelectorAll('.user-chip').forEach(btn => {
    const uid = btn.dataset.user;
    if (byId[uid]) btn.textContent = byId[uid];
    btn.classList.toggle('active', uid === state.userId);
    btn.onclick = () => {
      state.userId = uid; store.set({ userId: uid });
      document.body.classList.toggle('annie', state.userId === 'u_annie');
      row.querySelectorAll('.user-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      // After switching users, rebuild byId based on that user's exercises
      state.byId = Object.fromEntries(exercisesForUser().map(e=>[e.id, e]));
      renderFilters(); renderList(); renderSummary();
    };
  });
  document.body.classList.toggle('annie', state.userId === 'u_annie');
}

function renderFilters(){
  // Splits (only the current user's splits)
  const splitSel=$('#splitSelect');
  const splits=[...new Set(state.splits.filter(s=>(s.user_id||'u_camp')===state.userId).map(s=>String(s.split_name||'').trim()))].filter(Boolean);
  splitSel.innerHTML = `<option value="">All</option>` + splits.map(s=>`<option>${s}</option>`).join('');
  splitSel.value = state.currentSplit||'';
  splitSel.onchange = ()=>{ state.currentSplit=splitSel.value; store.set({split: state.currentSplit}); renderList(); };

  const items = exercisesForUser();

  // Equipment
  const eqRaw=[...new Set(items.map(e=>String(e.equipment||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const eqOpts=eqRaw.map(lbl=>({ value: lbl.toLowerCase(), label: lbl.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bEz\b/g,'EZ').replace(/\bV Bar\b/g,'V-Bar') }));
  $('#equipmentFilter').innerHTML = `<option value="">Equipment</option>` + eqOpts.map(o=>`<option value="${o.value}">${o.label}</option>`).join('');

  // Muscle
  const muscles = uniqueMuscles(items);
  $('#muscleFilter').innerHTML = `<option value="">Muscle</option>` + muscles.map(x=>`<option>${x}</option>`).join('');

  // selections
  $('#equipmentFilter').value = state.eq||'';
  $('#muscleFilter').value    = state.mg||'';
  $('#equipmentFilter').onchange = ()=>{ state.eq=$('#equipmentFilter').value; store.set({eq: state.eq}); renderList(); };
  $('#muscleFilter').onchange    = ()=>{ state.mg=$('#muscleFilter').value; store.set({mg: state.mg}); renderList(); };

  // add/reset
  $('#btnAddExercise').onclick = ()=> openAddWizard();
  $('#btnResetDone').onclick   = ()=>{ localStorage.removeItem('doneMap'); renderList(); toast('Highlights reset'); };
  $('#btnResetDone').textContent = 'Reset';
}

// ==== Cards/List ====
function makeCardHTML(e){
  const sugg = suggestNext(e.id, chooseSide(e.id));
  const variation = e.variation ? `<span class="variation">• ${e.variation}</span>` : '';
  const equip = e.equipment ? e.equipment : '';
  const h = Number(e.default_height||0);
  const setupLine = [equip, (h>0?`Height ${fmt(h)}`:'')].filter(Boolean).join(' • ');
  const done = isDone(e.id);

  return `
  <div class="card ${done?'done':''}" data-id="${e.id}">
    <div class="left">
      <div class="name-line"><span class="name">${e.name}</span>${variation}</div>
      <div class="meta line">${setupLine || '&nbsp;'}</div>
      <div class="weight line">${fmt(sugg.weight)} lb</div>
    </div>
    <div class="pill repsets">${fmt(sugg.reps)} × ${fmt(sugg.sets)}</div>
  </div>`;
}
function groupByEquipmentHTML(arr){
  const map=new Map();
  for(const e of arr){ const key=equipDisplay(e.equipment||''); if(!map.has(key)) map.set(key, []); map.get(key).push(e); }
  const keys=[...map.keys()].sort((a,b)=>a.localeCompare(b));
  return keys.map(k=>`
    <div class="subgroup">
      <div class="group-title">${k}</div>
      <div class="cards">${map.get(k).map(makeCardHTML).join('')}</div>
    </div>`).join('');
}
function renderList(){
  const eqVal=(state.eq||'').toLowerCase();
  const mgVal=state.mg||'';

  const wrapSel   = $('#selectedSplitWrap');
  const listSel   = $('#selectedSplitList');
  const otherTitle= $('#otherTitle');
  const otherList = $('#workoutList');

  let items = exercisesForUser().slice();
  if(eqVal) items = items.filter(e=>String(e.equipment||'').toLowerCase()===eqVal);
  if(mgVal) items = items.filter(e=>musclesOf(e).includes(mgVal));

  if(state.currentSplit){
    const splitRows = state.splits
      .filter(s=>String(s.split_name||'')===state.currentSplit && (s.user_id||'u_camp')===state.userId)
      .sort((a,b)=>Number(a.order||0)-Number(b.order||0));
    const splitIds = splitRows.map(r=>r.exercise_id);

    const top  = splitIds.map(id=>items.find(e=>e.id===id)).filter(Boolean);
    const rest = items.filter(e=>!splitIds.includes(e.id));

    wrapSel.hidden = false;
    listSel.innerHTML = top.map(makeCardHTML).join('');
    otherTitle.hidden = false;
    otherList.innerHTML = (!eqVal && !mgVal) ? groupByEquipmentHTML(rest) : rest.map(makeCardHTML).join('');
  } else {
    wrapSel.hidden = true;
    otherTitle.hidden = true;
    otherList.innerHTML = (!eqVal && !mgVal) ? groupByEquipmentHTML(items) : items.map(makeCardHTML).join('');
  }

  $$('#workoutList .card, #selectedSplitList .card').forEach(c=>{
    c.addEventListener('click',()=>openLog(c.dataset.id));
  });

  if(!items.length){
    otherList.innerHTML = `<div class="meta" style="padding:8px 4px;">No exercises for this user yet.</div>`;
  }
}

// ==== Log modal ====
let modal, stepVals, curEx;

function openLog(exId){
  curEx=state.byId[exId]; if(!curEx) return;
  modal=$('#logModal'); modal.dataset.didOther='';

  $('#logTitle').textContent=curEx.name;
  $('#logSub').textContent=[musclesOf(curEx).filter(Boolean).join('/'), curEx.equipment].filter(Boolean).join(' • ');

  const side = chooseSide(exId);
  $('#sideSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.side===side));

  const s=suggestNext(exId, side);
  stepVals={ side, sets_done:Number(curEx.sets||3), planned_reps:s.reps, weight_lb:s.weight, height:Number(s.height||0), fail_reps:s.reps, rpe_set2:8 };
  updateSteppers();
  $('#logNotes').value='';

  // side toggle
  $('#sideSeg').onclick = (e)=>{
    const b=e.target.closest('button'); if(!b) return;
    $('#sideSeg').querySelectorAll('button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); stepVals.side=b.dataset.side;
    saveSide(curEx.id, stepVals.side);
    const s=suggestNext(curEx.id, stepVals.side);
    stepVals.weight_lb=s.weight; stepVals.planned_reps=s.reps; stepVals.height=s.height; updateSteppers();
  };

  modal.showModal();
}

function updateSteppers(){
  $('.stack').querySelectorAll('.stepper').forEach(node=>{
    const field=node.dataset.field;
    const span=node.querySelector('.ctr span');
    if(field && span) span.textContent = fmt(stepVals[field]);
    if(!node.dataset.bound){
      const step = (field==='weight_lb') ? (Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB)) : 1;
      node.querySelector('.up').onclick   = ()=>{ stepVals[field]=Number(stepVals[field]||0)+step; span.textContent=fmt(stepVals[field]); };
      node.querySelector('.down').onclick = ()=>{ stepVals[field]=Math.max(0, Number(stepVals[field]||0)-step); span.textContent=fmt(stepVals[field]); };
      node.dataset.bound='1';
    }
  });
}

async function submitLog(skip){
  const sideUsed = stepVals.side || 'both';
  $('#btnLog').disabled = true; $('#btnSkip').disabled = true;

  const payload = {
    timestamp: new Date().toISOString(),
    date: today(),
    user_id: state.userId || 'u_camp',
    exercise_id: curEx.id,
    side: sideUsed,
    sets_done: Number(stepVals.sets_done),
    planned_reps: Number(stepVals.planned_reps),
    weight_lb: Number(stepVals.weight_lb),
    height: Number(stepVals.height||0),
    rpe_set2: Number(stepVals.rpe_set2),
    fail_reps: Number(stepVals.fail_reps),
    skip_progress: skip ? 1 : '',
    notes: $('#logNotes').value||''
  };

  try{
    const res = await apiPost('addLog', payload);
    if(res && !res.error){
      // If left/right, keep open for the other side
      if (sideUsed!=='both' && !modal.dataset.didOther){
        modal.dataset.didOther='1';
        const nextSide = sideUsed==='left' ? 'right' : 'left';
        $('#sideSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.side===nextSide));
        stepVals.side = nextSide; saveSide(curEx.id, nextSide);
        const s2 = suggestNext(curEx.id, nextSide);
        stepVals.weight_lb=s2.weight; stepVals.planned_reps=s2.reps; stepVals.height=s2.height; updateSteppers();
        toast(`Logged ${sideUsed}. Now ${nextSide}.`);
        $('#btnLog').disabled=false; $('#btnSkip').disabled=false;
        fetchAll(); // refresh history
        return;    // keep modal open
      }
      // otherwise close
      modal.dataset.didOther='';
      modal.close(); flash(); markDone(curEx.id); fetchAll();
    } else {
      toast('Error: ' + (res?.error || 'unknown'));
    }
  } catch(err){
    toast('Network error');
  } finally {
    $('#btnLog').disabled=false; $('#btnSkip').disabled=false;
  }
}
$('#btnLog')?.addEventListener('click',  e=>{ e.preventDefault(); submitLog(false); });
$('#btnSkip')?.addEventListener('click', e=>{ e.preventDefault(); submitLog(true);  });

// Add Exercise wizard
function openAddWizard(){
  const d=$('#addModal'); d.showModal();
  let step=0;
  const qs = $$('.wizard .q');
  function show(){
    qs.forEach((q,i)=>q.hidden = i!==step);
    $('#wizPrev').hidden = step===0;
    $('#wizNext').hidden = step===qs.length-1;
    $('#wizSave').hidden = step!==qs.length-1;
  }
  show();
  $('#wizPrev').onclick = ()=>{ step=Math.max(0,step-1); show(); };
  $('#wizNext').onclick = ()=>{ step=Math.min(qs.length-1,step+1); show(); };
  $('#wizSave').onclick = saveExercise;
}
async function saveExercise(){
  const btn=$('#wizSave'); if(btn.dataset.busy==='1') return;
  btn.dataset.busy='1'; btn.disabled=true; const orig=btn.textContent; btn.textContent='Saving…';
  const body={
    name: $('#exName').value.trim(),
    variation: $('#exVar').value.trim(),
    primary: $('#exPri').value.trim(),
    secondary: $('#exSec').value.trim(),
    tertiary: $('#exTer').value.trim(),
    equipment: $('#exEq').value.trim(),
    sets: Number($('#exSets').value||3),
    default_weight: Number($('#exW').value||0),
    default_height: Number($('#exH').value||0),
    increment_lb: $('#exInc').value.trim(),
    owner: state.userId || 'u_camp'
  };
  if(!body.name){ alert('Name required'); btn.dataset.busy='0'; btn.disabled=false; btn.textContent=orig; return; }
  try{
    const res = await apiPost('addExercise', body);
    if(res?.dedup){ toast('Already exists — using existing'); $('#addModal').close(); fetchAll(); }
    else if(res && !res.error){ toast('Exercise added'); $('#addModal').close(); fetchAll(); }
    else alert('Error: '+(res?.error||'unknown'));
  } catch(err){ alert('Network error'); }
  finally{ btn.dataset.busy='0'; btn.disabled=false; btn.textContent=orig; }
}

// ==== Summary (mirrored heat map) ====
const MUSCLE_LIST = ['Chest','Back','Trapezius','Shoulders','Front Delt','Side Delt','Rear Delt','Biceps','Triceps','Forearms','Abs','Glutes','Quads','Hamstrings','Calves'];
const MUSCLE_POINTS = { primary:3, secondary:2, tertiary:1 };
function musclePercents(period){
  const logs = logsForUser().filter(l=>inPeriod(l.date||l.timestamp, period));
  const score = new Map();
  for(const l of logs){
    const ex=state.byId[l.exercise_id]; if(!ex) continue;  // only current user's exercises
    for(const slot of ['primary','secondary','tertiary']){
      const m=(ex[slot]||'').trim(); if(!m) continue;
      score.set(m, (score.get(m)||0) + MUSCLE_POINTS[slot]);
    }
  }
  const total=[...score.values()].reduce((a,b)=>a+b,0)||1;
  const pct={}; MUSCLE_LIST.forEach(m=>pct[m]=Math.round(100*(score.get(m)||0)/total));
  return pct;
}
function heat(pct){
  const cs = getComputedStyle(document.body);
  const r = Number(cs.getPropertyValue('--accent-r') || 45);
  const g = Number(cs.getPropertyValue('--accent-g') || 212);
  const b = Number(cs.getPropertyValue('--accent-b') || 191);
  const alpha = 0.12 + 0.88 * (pct/100);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderSummary(){
  // update nav active state per current page restore
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));

  const wrap=$('#summaryContent'); const period=state.period;
  const st = streaks();

  // focus %
  const pct = musclePercents(period);
  const entries = Object.entries(pct).sort((a,b)=>b[1]-a[1]);
  const top = entries.slice(0,3);
  const neglected = entries.slice(-5);

  // most improved
  const imp = rankImprovements(period).slice(0,5);

  wrap.innerHTML = `
  <div class="block" style="padding:0 16px;">
    <h4 style="margin:0 0 6px">Streaks</h4>
    <div>Current: <b>${st.current}</b> weeks</div>
    <div>Best: <b>${st.best}</b> weeks</div>
    <div>Perfect weeks: <b>${st.perfectWeeks}</b></div>
  </div>

  <div class="block" style="padding:0 16px;">
    <h4 style="margin:0 0 12px">Muscle Focus (${period})</h4>
    <div id="mapWrap" style="display:grid; grid-template-columns:160px 1fr; gap:12px;">
      <svg id="muscleMap" viewBox="0 0 120 220" style="width:160px; height:auto; background:#0f1015; border:1px solid #1f2028; border-radius:12px; padding:6px;">
        <!-- mirrored silhouette -->
        <rect id="ChestL" x="30" y="52" width="12" height="14" rx="3" />
        <rect id="ChestR" x="78" y="52" width="12" height="14" rx="3" />
        <rect id="AbsL" x="46" y="68" width="10" height="26" rx="3" />
        <rect id="AbsR" x="64" y="68" width="10" height="26" rx="3" />
        <rect id="QuadsL" x="46" y="112" width="12" height="34" rx="3" />
        <rect id="QuadsR" x="62" y="112" width="12" height="34" rx="3" />
        <rect id="HamsL" x="46" y="112" width="12" height="18" rx="3" />
        <rect id="HamsR" x="62" y="112" width="12" height="18" rx="3" />
        <rect id="GlutesL" x="48" y="98" width="10" height="10" rx="3" />
        <rect id="GlutesR" x="62" y="98" width="10" height="10" rx="3" />
        <rect id="CalvesL" x="46" y="150" width="10" height="22" rx="3" />
        <rect id="CalvesR" x="64" y="150" width="10" height="22" rx="3" />
        <rect id="Back" x="52" y="45" width="16" height="24" rx="3" />
        <rect id="Trap" x="54" y="35" width="12" height="10" rx="3" />
        <rect id="ShoulderL" x="38" y="42" width="10" height="8" rx="3" />
        <rect id="ShoulderR" x="72" y="42" width="10" height="8" rx="3" />
        <rect id="BicepsL" x="34" y="58" width="7" height="12" rx="3" />
        <rect id="BicepsR" x="79" y="58" width="7" height="12" rx="3" />
        <rect id="TricepsL" x="30" y="58" width="5" height="12" rx="3" />
        <rect id="TricepsR" x="87" y="58" width="5" height="12" rx="3" />
        <rect id="ForearmsL" x="30" y="74" width="8" height="12" rx="3" />
        <rect id="ForearmsR" x="84" y="74" width="8" height="12" rx="3" />
      </svg>
      <div>
        <div style="margin-bottom:8px; font-weight:700">Top Focus</div>
        ${top.map(([m,v])=>`<div>${m}: <b>${v}%</b></div>`).join('') || '<div class="meta">No data</div>'}
        <div style="margin:12px 0 8px; font-weight:700">Most Neglected</div>
        ${neglected.map(([m,v])=>`<div>${m}: <b>${v}%</b></div>`).join('') || '<div class="meta">No data</div>'}
      </div>
    </div>
  </div>

  <div class="block" style="padding:0 16px;">
    <h4 style="margin:0 0 6px">Most Improved (${period})</h4>
    ${imp.length ? '<ol>'+imp.map(x=>`<li>${state.byId[x.id]?.name||x.id}: +${x.delta.toFixed(1)}</li>`).join('')+'</ol>' : '<div class="meta">No data yet</div>'}
  </div>`;

  const color = (v)=>heat(Math.max(0,Math.min(100,v||0)));
  const set = (id,m)=>{ const el=$('#'+id); if(el) el.style.fill = color(pct[m]); };

  set('Back','Back'); set('Trap','Trapezius');
  set('ChestL','Chest'); set('ChestR','Chest');
  set('AbsL','Abs'); set('AbsR','Abs');
  set('QuadsL','Quads'); set('QuadsR','Quads');
  set('HamsL','Hamstrings'); set('HamsR','Hamstrings');
  set('GlutesL','Glutes'); set('GlutesR','Glutes');
  set('CalvesL','Calves'); set('CalvesR','Calves');
  set('ShoulderL','Shoulders'); set('ShoulderR','Shoulders');
  set('BicepsL','Biceps'); set('BicepsR','Biceps');
  set('TricepsL','Triceps'); set('TricepsR','Triceps');
  set('ForearmsL','Forearms'); set('ForearmsR','Forearms');
}

// ==== toast / flash ====
function flash(){ const el=$('#flash'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.hidden=false; clearTimeout(el._t); el._t=setTimeout(()=>el.hidden=true, 1500); }

// ==== Boot ====
bindNav();
fetchAll();
// Restore page on first load
document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));
document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
const first = document.getElementById('page-'+state.page); if(first) first.classList.add('active');


// ====== PATCH v5 ======
// Make Summary its own page (toggle display) + body[data-page]
function setPage(page){
  state.page = page || 'list';
  store.set({ page: state.page });
  document.body.setAttribute('data-page', state.page);
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const target = document.getElementById('page-' + state.page);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Rebind nav to use setPage
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-nav]'); if(!btn) return;
  e.preventDefault();
  setPage(btn.dataset.nav);
}, true);

// Apply page on boot
(function(){ document.body.setAttribute('data-page', state.page || 'list'); })();

// Correct streaks: consecutive weeks with >=3 sessions; perfect >=5 sessions
function streaks(){
  const logs = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  const weeks = new Map(); // Monday as week start
  for(const l of logs){
    const d = new Date(l.date||l.timestamp);
    const w = new Date(d); w.setDate(d.getDate()-((d.getDay()+6)%7)); w.setHours(0,0,0,0);
    const key = w.toISOString().slice(0,10);
    weeks.set(key, (weeks.get(key)||0)+1);
  }
  const keys = [...weeks.keys()].sort();
  let cur=0, best=0, perfect=0, prevIdx=null;
  for(let i=0;i<keys.length;i++){
    const sessions = weeks.get(keys[i])||0;
    const qualifies = sessions >= 3;
    if(!qualifies){
      if(cur>best) best=cur;
      cur=0; prevIdx=null; // break in streak
      continue;
    }
    if(prevIdx===null || i===prevIdx+1) cur += 1;
    else cur = 1;
    if(cur>best) best=cur;
    if(sessions>=5) perfect += 1;
    prevIdx=i;
  }
  return { current:cur, best, perfectWeeks:perfect };
}

// Ensure renderSummary maintains page dataset for CSS
const _renderSummaryOriginal = renderSummary;
renderSummary = function(){
  document.body.setAttribute('data-page', state.page || 'list');
  _renderSummaryOriginal();
};

// On initial boot, apply page
setTimeout(()=>setPage(state.page || 'list'), 0);


// ====== PATCH v6 — robust streak computation ======
// Build a continuous calendar of weeks so gaps break streaks properly.
function _weekKeyMonday(d){
  const w = new Date(d); w.setDate(d.getDate()-((d.getDay()+6)%7)); w.setHours(0,0,0,0);
  return w.toISOString().slice(0,10);
}
function _addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

function streaks(){
  const rows = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  if(!rows.length) return { current:0, best:0, perfectWeeks:0 };
  const weekly = new Map();
  for(const l of rows){
    const dt = new Date(l.date || l.timestamp);
    const key = _weekKeyMonday(dt);
    weekly.set(key, (weekly.get(key)||0) + 1);
  }
  // Build continuous weekly array from min week to current week
  const firstKey = _weekKeyMonday(new Date(rows[0].date||rows[0].timestamp));
  const lastKey  = _weekKeyMonday(new Date()); // this week
  const weeks = [];
  for(let d=new Date(firstKey); d<=new Date(lastKey); d=_addDays(d,7)){
    const k = d.toISOString().slice(0,10);
    weeks.push({ key:k, sessions: weekly.get(k)||0 });
  }
  // Best and current streaks for >=3 sessions
  let best=0, cur=0;
  for(const w of weeks){
    if(w.sessions>=3){ cur+=1; best=Math.max(best,cur); }
    else cur=0;
  }
  // Current streak counts back from the end
  let current=0;
  for(let i=weeks.length-1;i>=0;i--){
    if(weeks[i].sessions>=3) current++;
    else break;
  }
  // Perfect weeks: total across history (>=5)
  const perfectWeeks = weeks.filter(w=>w.sessions>=5).length;
  return { current, best, perfectWeeks };
}


// ====== PATCH v7 — streaks count UNIQUE DAYS (sessions) per week ======
function _dateOnlyStringUTCish(val){
  // Prefer l.date in YYYY-MM-DD; fallback to timestamp->ISO date
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  // use UTC date part to avoid timezone off-by-one; sheet stores date-only
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function _weekKeyFromDateStr(yyyy_mm_dd){
  // Build local date at noon to avoid DST quirks, then shift to Monday
  const d = new Date(yyyy_mm_dd+'T12:00:00');
  const w = new Date(d); w.setDate(d.getDate()-((d.getDay()+6)%7)); w.setHours(0,0,0,0);
  return w.toISOString().slice(0,10);
}
function _addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }

function streaks(){
  const rows = logsForUser().slice().sort((a,b)=> new Date(a.date||a.timestamp)-new Date(b.date||b.timestamp));
  if(!rows.length) return { current:0, best:0, perfectWeeks:0 };

  // Map: weekKey -> Set(unique dayKeys) so each workout day counts once
  const weekToDays = new Map();
  for(const l of rows){
    const dayKey = _dateOnlyStringUTCish(l.date || l.timestamp);   // 'YYYY-MM-DD'
    const weekKey = _weekKeyFromDateStr(dayKey);
    if(!weekToDays.has(weekKey)) weekToDays.set(weekKey, new Set());
    weekToDays.get(weekKey).add(dayKey);
  }

  // Build continuous weekly array from earliest to this week
  const firstKey = _weekKeyFromDateStr(_dateOnlyStringUTCish(rows[0].date || rows[0].timestamp));
  const lastKey  = _weekKeyFromDateStr(_dateOnlyStringUTCish(new Date()));
  const weeks = [];
  for(let d=new Date(firstKey); d<=new Date(lastKey); d=_addDays(d,7)){
    const k = d.toISOString().slice(0,10);
    const sessions = (weekToDays.get(k) || new Set()).size; // UNIQUE DAYS
    weeks.push({ key:k, sessions });
  }

  // Compute best and current streaks for >=3 sessions/week
  let best=0, cur=0;
  for(const w of weeks){
    if(w.sessions>=3){ cur+=1; best=Math.max(best,cur); }
    else cur=0;
  }
  let current=0;
  for(let i=weeks.length-1;i>=0;i--){
    if(weeks[i].sessions>=3) current++;
    else break;
  }
  const perfectWeeks = weeks.filter(w=>w.sessions>=5).length;
  return { current, best, perfectWeeks };
}


// ====== PATCH v8 — Most Improved uses baseline BEFORE the period and effective reps ======
function _parseDate(val){
  if(typeof val==='string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val+'T12:00:00');
  return new Date(val);
}
function _periodStart(p){ return startOfPeriod(p); }

function rankImprovements(period){
  const start = _periodStart(period);
  const logs = logsForUser().slice().sort((a,b)=> _parseDate(a.date||a.timestamp) - _parseDate(b.date||b.timestamp));

  const map = new Map();
  for(const l of logs){
    const t = _parseDate(l.date||l.timestamp);
    const repsEff = Math.max(Number(l.planned_reps||0), Number(l.fail_reps||0)); // use fail reps if higher
    const val = e1rm(Number(l.weight_lb||0), repsEff);
    const arr = map.get(l.exercise_id)||[]; arr.push({t, val}); map.set(l.exercise_id, arr);
  }

  const out = [];
  const now = new Date();

  for(const [id, arrRaw] of map.entries()){
    const arr = arrRaw.slice().sort((a,b)=>a.t-b.t);
    const inside = arr.filter(x=>x.t >= start && x.t <= now);
    if(!inside.length) continue;
    const currentVal = inside[inside.length - 1].val;
    const before = arr.filter(x=>x.t < start);
    const baselineVal = before.length ? before[before.length - 1].val : inside[0].val;
    const delta = currentVal - baselineVal;
    out.push({ id, delta, currentVal, baselineVal, isNew: !before.length });
  }

  out.sort((a,b)=> b.delta - a.delta);
  return out;
}



// ====== PATCH v9 — Optimistic log + stepper pulse ======

// Local done map helpers
function setDoneLocal(exId, tsOrNull){
  const map = JSON.parse(localStorage.getItem('doneMap')||'{}');
  if (tsOrNull == null) delete map[exId];
  else map[exId] = tsOrNull;
  localStorage.setItem('doneMap', JSON.stringify(map));
}
function optimisticMarkDone(exId){
  const map = JSON.parse(localStorage.getItem('doneMap')||'{}');
  const prev = Object.prototype.hasOwnProperty.call(map, exId) ? map[exId] : null;

  // Apply highlight immediately
  setDoneLocal(exId, Date.now());
  const card = document.querySelector(`.card[data-id="${exId}"]`);
  if (card) card.classList.add('done');
  flash();
  try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}

  // Rollback if API fails
  return () => {
    if (prev === null) setDoneLocal(exId, null); else setDoneLocal(exId, prev);
    if (card) card.classList.remove('done');
  };
}

// Small haptic on steppers (no-op if unsupported)
function tinyHaptic(){ try { if (navigator.vibrate) navigator.vibrate(5); } catch (_) {} }

function stepperPulse(node, dir){
  node.classList.remove('pulse-up','pulse-down');
  void node.offsetWidth; // reflow to restart animation
  node.classList.add(dir === 'up' ? 'pulse-up' : 'pulse-down');
}

// Override updateSteppers to add pulses on up/down
(function(){
  const _update = updateSteppers;
  updateSteppers = function(){
    _update();
    document.querySelectorAll('.stack .stepper').forEach(node=>{
      if(node.dataset.pulseBound==='1') return;
      node.dataset.pulseBound='1';
      const up   = node.querySelector('.up');
      const down = node.querySelector('.down');
      if(up) up.addEventListener('click',  ()=>{ stepperPulse(node,'up'); tinyHaptic(); });
      if(down) down.addEventListener('click',()=>{ stepperPulse(node,'down'); tinyHaptic(); });
    });
  };
})();

// Optimistic submitLog (instant UI, rollback on failure)
async function submitLog(skip){
  const sideUsed = stepVals.side || 'both';

  // Optimistic highlight + flash now
  const rollback = optimisticMarkDone(curEx.id);

  // Lock buttons to avoid double taps
  $('#btnLog').disabled = true; $('#btnSkip').disabled = true;

  const payload = {
    timestamp: new Date().toISOString(),
    date: today(),
    user_id: state.userId || 'u_camp',
    exercise_id: curEx.id,
    side: sideUsed,
    sets_done: Number(stepVals.sets_done),
    planned_reps: Number(stepVals.planned_reps),
    weight_lb: Number(stepVals.weight_lb),
    height: Number(stepVals.height||0),
    rpe_set2: Number(stepVals.rpe_set2),
    fail_reps: Number(stepVals.fail_reps),
    skip_progress: skip ? 1 : '',
    notes: $('#logNotes').value||''
  };

  try{
    const res = await apiPost('addLog', payload);
    if(res && !res.error){
      if (sideUsed!=='both' && !modal.dataset.didOther){
        // Keep open and switch side
        modal.dataset.didOther='1';
        const nextSide = sideUsed==='left' ? 'right' : 'left';
        $('#sideSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.side===nextSide));
        stepVals.side = nextSide; saveSide(curEx.id, nextSide);
        const s2 = suggestNext(curEx.id, nextSide);
        stepVals.weight_lb=s2.weight; stepVals.planned_reps=s2.reps; stepVals.height=s2.height; updateSteppers();
        toast(`Logged ${sideUsed}. Now ${nextSide}.`);
      } else {
        modal.dataset.didOther='';
        modal.close();
      }
      fetchAll(); // refresh silently
    } else {
      rollback();
      toast('Error saving log');
    }
  } catch(err){
    rollback();
    toast('Network error');
  } finally {
    $('#btnLog').disabled = false; $('#btnSkip').disabled = false;
  }
}



// ====== PATCH v10 — Cancel closes modal ======
document.addEventListener('click', (e)=>{
  const b=e.target.closest('#btnCancel');
  if(!b) return;
  e.preventDefault();
  try { document.getElementById('logModal').close(); } catch(_){}
});



// ====== PATCH v11 — instant-close modal on Log/Skip (background write) ======
async function submitLog(skip){
  const sideUsed = stepVals.side || 'both';

  // Optimistic highlight immediately
  const rollback = optimisticMarkDone(curEx.id);

  // Close the modal right away so it feels instant
  try { document.getElementById('logModal').close(); } catch(_){}

  const payload = {
    timestamp: new Date().toISOString(),
    date: today(),
    user_id: state.userId || 'u_camp',
    exercise_id: curEx.id,
    side: sideUsed,
    sets_done: Number(stepVals.sets_done),
    planned_reps: Number(stepVals.planned_reps),
    weight_lb: Number(stepVals.weight_lb),
    height: Number(stepVals.height||0),
    rpe_set2: Number(stepVals.rpe_set2),
    fail_reps: Number(stepVals.fail_reps),
    skip_progress: skip ? 1 : '',
    notes: $('#logNotes').value||''
  };

  // Fire-and-handle in background; UI is already updated
  apiPost('addLog', payload)
    .then(res => {
      if(res && !res.error){
        fetchAll(); // refresh silently
      }else{
        rollback(); toast('Error saving log');
      }
    })
    .catch(()=>{ rollback(); toast('Network error'); });
}
