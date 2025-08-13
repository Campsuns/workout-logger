// ==== CONFIG – keep your values here ====
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzQmuBTqcODPLJc2U1GhIgKEK_xaa0buIdC55mIWv1hg7QoXwyxe36tMNfjyl3HIWFKew/exec',
  TOKEN: 'n7V6p3kFQw9zL1r8U2y4T0bC5mA7',
  WEEK_START: 1,
  REP_MIN: 6,
  REP_MAX: 12,
  DEFAULT_INC_LB: 5,
  DONE_TTL_HOURS: 8, // card highlight TTL
};

// ==== State ====
let state = {
  users: [],
  userId: 'u_camp',                     // 'u_camp' | 'u_annie' | 'all'
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

// ==== User scoping ====
function logsForUser(){
  const uid = state.userId;
  if(uid==='all') return state.logs;
  return state.logs.filter(l => (l.user_id || 'u_camp') === uid);
}
function exercisesForUser(){
  const uid=state.userId;
  return state.exercises.filter(e=>{
    const owner=(e.owner||'all').toLowerCase();
    return uid==='all' ? true : (owner==='all' || owner===uid);
  });
}
function renderUserSwitcher(){
  const sel = $('#userSelect'); if(!sel) return;
  const opts = [{user_id:'all', name:'All'}].concat(state.users);
  sel.innerHTML = opts.map(u=>`<option value="${u.user_id}">${u.name}</option>`).join('');
  const saved = store.get().userId || 'u_camp';
  state.userId = saved; sel.value = saved;
  sel.onchange = () => { state.userId = sel.value; store.set({userId: state.userId}); renderList(); renderSummary(); };
}

// ==== Latest log / Suggestion ====
function isSkip(l){ const v=String(l.skip_progress??'').toLowerCase(); return v==='1'||v==='true'||v==='yes'; }
function latestFor(exId, side){
  const uid = state.userId==='all' ? null : state.userId;
  const want = String(side || 'both').toLowerCase();
  const norm = x => String(x || 'both').toLowerCase();
  const valid = state.logs.filter(l => l.exercise_id===exId && (!uid || (l.user_id||'u_camp')===uid) && !isSkip(l));
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

  // Rep-first 6–12, then +5 lb, soft deload on struggle
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

// ==== Improvements / Streaks ====
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
function streaks(allLogs){
  // consecutive weeks with ≥3 sessions
  const weeks = new Map();
  for(const l of allLogs){
    const d=new Date(l.date||l.timestamp);
    const key = d.getFullYear()+'-'+Math.ceil((((d - new Date(d.getFullYear(),0,1))/86400000)+1)/7);
    weeks.set(key, (weeks.get(key)||0)+1);
  }
  const keys=[...weeks.keys()].sort();
  let cur=0,best=0,perfect=0, prev=null;
  for(const k of keys){
    const v=weeks.get(k); const wk=parseInt(k.split('-')[1],10);
    if(prev===null || wk===prev+1) cur++; else cur=1;
    if(v>=5) perfect++;
    if(cur>best) best=cur;
    prev=wk;
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
  state.byId      = Object.fromEntries(state.exercises.map(e=>[e.id, e]));
  renderUserChips();
  renderFilters();
  renderList();
  renderSummary();
}

// ==== Nav + restore ====
$$('[data-nav]').forEach(btn => btn.addEventListener('click', ()=>{
  const page = btn.dataset.nav;
  $$('[data-nav]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.page = page; store.set({page});
  $$('.page').forEach(p=>p.classList.remove('active'));
  $('#page-'+page).classList.add('active');
}));
(function restoreUI(){
  const s=store.get();
  if(s.page){
    state.page=s.page;
    $$('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===state.page));
    $$('.page').forEach(p=>p.classList.remove('active'));
    $('#page-'+state.page).classList.add('active');
  }
  if(s.split!==undefined) state.currentSplit=s.split;
  if(s.period) state.period=s.period;
  if(s.eq!==undefined) state.eq=s.eq;
  if(s.mg!==undefined) state.mg=s.mg;
  if(s.userId) state.userId=s.userId;
})();
$('.period-tabs')?.querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $('.period-tabs').querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.period=btn.dataset.period; store.set({period: state.period});
    renderSummary();
  });
});

// ==== Filters ====
function renderFilters(){
  // Splits
  const splitSel=$('#splitSelect');
  const splits=[...new Set(state.splits.map(s=>String(s.split_name||'').trim()))].filter(Boolean);
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
      .filter(s=>String(s.split_name||'')===state.currentSplit && (!state.userId || !s.user_id || s.user_id===state.userId))
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
    otherList.innerHTML = `<div class="meta" style="padding:8px 4px;">No exercises match the current filters.</div>`;
  }
}

function renderUserChips(){
  const row = document.querySelector('#userRow');
  if(!row) return;

  // If Users sheet returns names, reflect them (fallback to labels already in HTML)
  const byId = Object.fromEntries((state.users||[]).map(u=>[u.user_id, u.name]));
  row.querySelectorAll('.user-chip').forEach(btn=>{
    const uid = btn.dataset.user;
    if (byId[uid]) btn.textContent = byId[uid];
  });

  // Active state
  row.querySelectorAll('.user-chip').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.user === state.userId);
    btn.onclick = ()=>{
      state.userId = btn.dataset.user;
      store.set({ userId: state.userId });

      // swap theme (Annie → pastel purple)
      document.body.classList.toggle('annie', state.userId === 'u_annie');

      // refresh UI
      renderList();
      renderSummary();

      // toggle active classes
      row.querySelectorAll('.user-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  // Apply theme on boot, too
  document.body.classList.toggle('annie', state.userId === 'u_annie');
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
    // bind if not already
    if(!node.dataset.bound){
      const step = (field==='weight_lb') ? (Number(curEx.increment_lb||CONFIG.DEFAULT_INC_LB)) : 1;
      node.querySelector('.up').onclick   = ()=>{ stepVals[field]=Number(stepVals[field]||0)+step; span.textContent=fmt(stepVals[field]); };
      node.querySelector('.down').onclick = ()=>{ stepVals[field]=Math.max(0, Number(stepVals[field]||0)-step); span.textContent=fmt(stepVals[field]); };
      node.dataset.bound='1';
    }
  });
}

// submit (normal + skip progress)
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
$('#btnLog').addEventListener('click',  e=>{ e.preventDefault(); submitLog(false); });
$('#btnSkip').addEventListener('click', e=>{ e.preventDefault(); submitLog(true);  });

// ==== Add Exercise wizard ====
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

// ==== Summary (muscle map) ====
const MUSCLE_LIST = ['Chest','Back','Trapezius','Shoulders','Front Delt','Side Delt','Rear Delt','Biceps','Triceps','Forearms','Abs','Glutes','Quads','Hamstrings','Calves'];
const MUSCLE_POINTS = { primary:3, secondary:2, tertiary:1 };
function musclePercents(period){
  const logs = logsForUser().filter(l=>inPeriod(l.date||l.timestamp, period));
  const score = new Map();
  for(const l of logs){
    const ex=state.byId[l.exercise_id]; if(!ex) continue;
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
  // pct is 0–100; base color from CSS theme (teal vs pastel purple)
  const cs = getComputedStyle(document.body);
  const r = Number(cs.getPropertyValue('--accent-r') || 45);
  const g = Number(cs.getPropertyValue('--accent-g') || 212);
  const b = Number(cs.getPropertyValue('--accent-b') || 191);
  const alpha = 0.12 + 0.88 * (pct/100);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


function renderSummary(){
  const wrap=$('#summaryContent'); const period=state.period;
  const st = streaks(logsForUser());

  // focus %
  const pct = musclePercents(period);
  const entries = Object.entries(pct).sort((a,b)=>b[1]-a[1]);
  const top = entries.slice(0,3);
  const neglected = entries.slice(-5);

  // most improved
  const imp = rankImprovements(period).slice(0,5);

  wrap.innerHTML = `
  <div class="block">
    <h4 style="margin:0 0 6px">Streaks</h4>
    <div>Current: <b>${st.current}</b> weeks</div>
    <div>Best: <b>${st.best}</b> weeks</div>
    <div>Perfect weeks: <b>${st.perfectWeeks}</b></div>
  </div>

  <div class="block">
    <h4 style="margin:0 0 12px">Muscle Focus (${period})</h4>
    <div id="mapWrap" style="display:grid; grid-template-columns:160px 1fr; gap:12px;">
      <svg id="muscleMap" viewBox="0 0 120 220" style="width:160px; height:auto; background:#0f1015; border:1px solid #1f2028; border-radius:12px; padding:6px;">
        <rect id="Chest" x="35" y="45" width="50" height="16" rx="3" />
        <rect id="Abs" x="48" y="65" width="24" height="28" rx="3" />
        <rect id="Quads" x="45" y="115" width="16" height="36" rx="3" />
        <rect id="Hamstrings" x="63" y="115" width="16" height="36" rx="3" />
        <rect id="Glutes" x="52" y="102" width="20" height="12" rx="3" />
        <rect id="Calves" x="45" y="156" width="16" height="26" rx="3" />
        <rect id="Back" x="32" y="45" width="16" height="30" rx="3" />
        <rect id="Trapezius" x="50" y="35" width="20" height="10" rx="3" />
        <rect id="Shoulders" x="28" y="42" width="20" height="10" rx="3" />
        <rect id="Biceps" x="20" y="60" width="14" height="12" rx="3" />
        <rect id="Triceps" x="14" y="60" width="8" height="12" rx="3" />
        <rect id="Forearms" x="12" y="76" width="12" height="12" rx="3" />
        <rect id="Front Delt" x="50" y="42" width="12" height="8" rx="3" />
        <rect id="Side Delt" x="64" y="42" width="12" height="8" rx="3" />
        <rect id="Rear Delt" x="78" y="42" width="12" height="8" rx="3" />
      </svg>
      <div>
        <div style="margin-bottom:8px; font-weight:700">Top Focus</div>
        ${top.map(([m,v])=>`<div>${m}: <b>${v}%</b></div>`).join('') || '<div class="meta">No data</div>'}
        <div style="margin:12px 0 8px; font-weight:700">Most Neglected</div>
        ${neglected.map(([m,v])=>`<div>${m}: <b>${v}%</b></div>`).join('') || '<div class="meta">No data</div>'}
      </div>
    </div>
  </div>

  <div class="block">
    <h4 style="margin:0 0 6px">Most Improved (${period})</h4>
    ${imp.length ? '<ol>'+imp.map(x=>`<li>${state.byId[x.id]?.name||x.id}: +${x.delta.toFixed(1)}</li>`).join('')+'</ol>' : '<div class="meta">No data yet</div>'}
  </div>`;

  // color map
  for(const [m,v] of Object.entries(pct)){
    const el = document.querySelector(`#muscleMap [id="${m}"]`);
    if(el) el.style.fill = heat(v);
  }
}

// ==== toast / flash ====
function flash(){ const el=$('#flash'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.hidden=false; clearTimeout(el._t); el._t=setTimeout(()=>el.hidden=true, 1500); }

// boot
fetchAll();
